// ============================================================
// PDF_Contrats.mjs — 1 PDF par contrat non signé
//
// FONCTIONNEMENT :
//   1. Lit les fichiers ci_*.html pour détecter les non signés
//   2. Se connecte à ANAPEC avec les vrais credentials
//   3. Navigue vers /edition_ci/ID (vrai rendu ANAPEC avec logo)
//   4. Génère 1 PDF par contrat → C:\anapec\PDF\SOCIETE\REF.pdf
//
// USAGE :
//   node C:\anapec\PDF_Contrats.mjs              ← toutes sociétés
//   node C:\anapec\PDF_Contrats.mjs SIGARMOR     ← une société
//   node C:\anapec\PDF_Contrats.mjs KIRKOS NEISS ← plusieurs
// ============================================================

import puppeteer from 'puppeteer';
import { readFileSync, existsSync, readdirSync, mkdirSync } from 'fs';
import { join } from 'path';

const BASE_URL  = 'https://www.anapec.org/sigec-app-rv/fr/entreprises';
const BASE_DIR  = 'C:\\anapec';
const PDF_DIR   = join(BASE_DIR, 'PDF');       // C:\anapec\PDF\

// 8 sociétés avec credentials
const SOCIETES = [
  { nom: 'GRUPO_TEYEZ',  email: 'grupoteyez@gmail.com',          password: '123456' },
  { nom: 'SIGARMOR',     email: 'sigarmorgroup@gmail.com',        password: '123456' },
  { nom: 'EIM',          email: 'ecoleimanagement@gmail.com',     password: '123456' },
  { nom: 'KIRKOS',       email: 'groupekirkos@gmail.com',         password: '123456' },
  { nom: 'KIRKOS_GUARD', email: 'groupekirkosguarduim@gmail.com', password: '123456' },
  { nom: 'NEISS',        email: 'neissinvest@gmail.com',          password: '123456' },
  { nom: 'NORIA_BIANCA', email: 'yelgartili@groupekirkos.ma',     password: '123456' },
  { nom: 'CQ_SERVICE',   email: 'info.cqservice@gmail.com',       password: '123456' },
];

// ─────────────────────────────────────────────────────────────
// Détecter contrat non signé (cases signature vides)
// ─────────────────────────────────────────────────────────────
function isUnsigned(html) {
  // Fichier trop petit = template vide, pas de contenu
  if (html.length < 15000) return false;

  // Zone signature française : L'employeur | Le stagiaire | VISA ANAPEC
  const sigIdxFr = html.search(/L.employeur[\s\S]{0,150}Le stagiaire/i);
  if (sigIdxFr >= 0) {
    const zone = html.substring(sigIdxFr, sigIdxFr + 800);
    const tdAll = zone.match(/<td[^>]*>([\s\S]*?)<\/td>/gi) || [];
    const sigCells = tdAll.slice(3, 6);
    const contents = sigCells.map(td =>
      td.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, '').replace(/\s+/g, '').trim()
    );
    if (sigCells.length >= 2) {
      return contents.every(c => c.length === 0);
    }
  }

  // Zone signature arabe
  const sigIdxAr = html.search(/توقيع[\s\S]{0,100}توقيع/i);
  if (sigIdxAr >= 0) {
    const zone = html.substring(sigIdxAr, sigIdxAr + 600);
    const tdAll = zone.match(/<td[^>]*>([\s\S]*?)<\/td>/gi) || [];
    const sigCells = tdAll.slice(2, 5);
    const contents = sigCells.map(td =>
      td.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, '').replace(/\s+/g, '').trim()
    );
    if (sigCells.length >= 1) {
      return contents.every(c => c.length === 0);
    }
  }

  // "Fait à........ le........" présent mais pas de signature
  if (html.match(/Fait\s+[àa]\s*[.……]+/i)) return true;

  return false;
}

// ─────────────────────────────────────────────────────────────
// Extraire l'ID numérique depuis le nom de fichier
// ci_1562940.html → 1562940
// ─────────────────────────────────────────────────────────────
function extractId(filename) {
  const m = filename.match(/ci_(\d+)\.html/);
  return m ? m[1] : null;
}

// ─────────────────────────────────────────────────────────────
// Extraire la référence contrat depuis le HTML
// ─────────────────────────────────────────────────────────────
function extractRef(html) {
  const m = html.match(/\b([A-Z]{0,3}\d{8,}\/\d+)\b/);
  return m ? m[1].replace(/\//g, '-') : 'REF_INCONNUE';
}

// ─────────────────────────────────────────────────────────────
// Se connecter à ANAPEC
// ─────────────────────────────────────────────────────────────
async function login(page, email, password) {
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle2', timeout: 30000 });

  // Remplir email
  await page.waitForSelector('input[type="email"], input[name="email"], input[id*="email"]', { timeout: 10000 });
  const emailInput = await page.$('input[type="email"]') ||
                     await page.$('input[name="email"]') ||
                     await page.$('input[id*="email"]');
  if (emailInput) {
    await emailInput.click({ clickCount: 3 });
    await emailInput.type(email);
  }

  // Remplir mot de passe
  const pwInput = await page.$('input[type="password"]');
  if (pwInput) {
    await pwInput.click({ clickCount: 3 });
    await pwInput.type(password);
  }

  // Soumettre
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 20000 }),
    page.keyboard.press('Enter'),
  ]);

  // Vérifier connexion
  const url = page.url();
  const isLoggedIn = !url.includes('login') && !url.includes('connexion');
  return isLoggedIn;
}

// ─────────────────────────────────────────────────────────────
// Générer le PDF d'un contrat
// ─────────────────────────────────────────────────────────────
async function generatePdf(page, ciId, outputPath) {
  const url = `${BASE_URL}/edition_ci/${ciId}`;

  await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

  // Attendre que le contenu soit chargé
  try {
    await page.waitForFunction(
      () => {
        const el = document.querySelector('.printable, .arriereprintable');
        return el && el.innerHTML && el.innerHTML.length > 2000;
      },
      { timeout: 8000 }
    );
  } catch(e) {
    await new Promise(r => setTimeout(r, 2000));
  }

  // Masquer les éléments non imprimables (boutons, alertes, nav)
  await page.evaluate(() => {
    // Masquer boutons et messages
    document.querySelectorAll(
      '.noPrint, button, .alert, nav, header, footer, #Print, ' +
      '.btn, [class*="btn-"], .navbar, .sidebar'
    ).forEach(el => el.style.display = 'none');

    // Afficher la zone imprimable
    document.querySelectorAll('.printable, .arriereprintable')
      .forEach(el => el.style.display = 'block');
  });

  // Générer le PDF
  await page.pdf({
    path: outputPath,
    format: 'A4',
    printBackground: true,
    margin: { top: '10mm', bottom: '10mm', left: '10mm', right: '10mm' },
  });
}

// ─────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────
async function main() {
  // Filtrer sociétés via args CLI
  const args = process.argv.slice(2).map(a => a.toUpperCase());
  const societes = args.length > 0
    ? SOCIETES.filter(s => args.includes(s.nom))
    : SOCIETES;

  if (societes.length === 0) {
    console.log('❌ Société inconnue. Disponibles:', SOCIETES.map(s=>s.nom).join(', '));
    process.exit(1);
  }

  console.log('\n╔══════════════════════════════════════════════════╗');
  console.log('║  PDF_Contrats — 1 PDF par contrat non signé      ║');
  console.log('╚══════════════════════════════════════════════════╝\n');

  // Créer dossier PDF principal
  if (!existsSync(PDF_DIR)) mkdirSync(PDF_DIR, { recursive: true });

  // Lancer Puppeteer
  const browser = await puppeteer.launch({
    headless: false,   // ← visible pour voir la progression
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    defaultViewport: { width: 1200, height: 900 }
  });

  let totalGenerated = 0;
  let totalSkipped   = 0;
  let totalErrors    = 0;

  for (const societe of societes) {
    const societeDir = join(BASE_DIR, societe.nom);
    if (!existsSync(societeDir)) {
      console.log(`\n⚠️  ${societe.nom}: dossier introuvable → ignoré`);
      continue;
    }

    // Trouver les fichiers HTML non signés
    const files = readdirSync(societeDir)
      .filter(f => f.startsWith('ci_') && f.endsWith('.html'));

    const unsignedFiles = [];
    for (const file of files) {
      const html = readFileSync(join(societeDir, file), 'utf8');
      if (isUnsigned(html)) {
        const id  = extractId(file);
        const ref = extractRef(html);
        if (id) unsignedFiles.push({ file, id, ref });
      }
    }

    if (unsignedFiles.length === 0) {
      console.log(`\n━━━ ${societe.nom}: aucun contrat non signé`);
      continue;
    }

    console.log(`\n━━━ ${societe.nom} — ${unsignedFiles.length} contrats non signés`);

    // Créer dossier PDF/SOCIETE
    const societeOutDir = join(PDF_DIR, societe.nom);
    if (!existsSync(societeOutDir)) mkdirSync(societeOutDir, { recursive: true });

    // Ouvrir un onglet et se connecter
    const page = await browser.newPage();
    page.setDefaultNavigationTimeout(30000);

    const loggedIn = await login(page, societe.email, societe.password);
    if (!loggedIn) {
      console.log(`  ❌ Connexion échouée pour ${societe.email}`);
      await page.close();
      continue;
    }
    console.log(`  ✅ Connecté: ${societe.email}`);

    // Générer les PDFs
    for (const { file, id, ref } of unsignedFiles) {
      const pdfPath = join(societeOutDir, `${ref}.pdf`);

      // Sauter si déjà généré
      if (existsSync(pdfPath)) {
        process.stdout.write(`  ⏭  ${ref}.pdf (déjà existant)\n`);
        totalSkipped++;
        continue;
      }

      try {
        process.stdout.write(`  ⏳ ${ref}...`);
        await generatePdf(page, id, pdfPath);
        process.stdout.write(` ✅\n`);
        totalGenerated++;
        await new Promise(r => setTimeout(r, 500));
      } catch(e) {
        process.stdout.write(` ❌ ${e.message.substring(0,60)}\n`);
        totalErrors++;
      }
    }

    await page.close();
  }

  await browser.close();

  // Résumé
  console.log('\n╔══════════════════════════════════════════════════╗');
  console.log(`║  ✅ Générés  : ${String(totalGenerated).padEnd(33)}║`);
  console.log(`║  ⏭  Existants: ${String(totalSkipped).padEnd(33)}║`);
  console.log(`║  ❌ Erreurs  : ${String(totalErrors).padEnd(33)}║`);
  console.log(`║  📁 Dossier  : ${PDF_DIR.padEnd(33)}║`);
  console.log('╚══════════════════════════════════════════════════╝\n');

  if (totalGenerated > 0) {
    console.log(`💡 Les PDFs sont dans : ${PDF_DIR}`);
    console.log(`   Structure : PDF\\SOCIETE\\REF_CONTRAT.pdf`);
  }
}

main().catch(e => {
  console.error('❌ ERREUR CRITIQUE:', e.message);
  process.exit(1);
});
