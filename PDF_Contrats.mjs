// ============================================================
// PDF_Contrats.mjs — 1 PDF par contrat non signé
// v8 - FIXES:
//   1. cleanPuppeteerProfiles() sans await (bug SyntaxError corrigé)
//   2. isUnsigned() détecte signatures arabes ET françaises
//   3. Login ANAPEC corrigé (même méthode que scraper v7)
//   4. Restart browser toutes les 40 pages (anti-crash)
//   5. Détection SESSION_EXPIRED avec reconnexion auto
//
// USAGE :
//   node C:\anapec\PDF_Contrats.mjs
//   node C:\anapec\PDF_Contrats.mjs SIGARMOR
//   node C:\anapec\PDF_Contrats.mjs KIRKOS NEISS
// ============================================================

import puppeteer from 'puppeteer';
import { readFileSync, existsSync, readdirSync, mkdirSync, unlinkSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const HOME_URL = 'https://www.anapec.org/sigec-app-rv/';
const BASE_URL = 'https://www.anapec.org/sigec-app-rv/fr/entreprises';
const BASE_DIR = 'C:\\anapec';
const PDF_DIR  = join(BASE_DIR, 'PDF');

const RESTART_EVERY = 40;

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
// Nettoyer lockfiles Puppeteer orphelins (fonction SYNC)
// ─────────────────────────────────────────────────────────────
function cleanPuppeteerProfiles() {
  try {
    const tmp = tmpdir();
    const dirs = readdirSync(tmp).filter(d => d.startsWith('puppeteer_dev_'));
    for (const dir of dirs) {
      const lockfile = join(tmp, dir, 'lockfile');
      if (existsSync(lockfile)) {
        try { unlinkSync(lockfile); } catch(e) {}
      }
    }
  } catch(e) {}
}

// ─────────────────────────────────────────────────────────────
// Lancer le browser Edge
// ─────────────────────────────────────────────────────────────
async function launchBrowser() {
  cleanPuppeteerProfiles();
  await new Promise(r => setTimeout(r, 1000));
  return puppeteer.launch({
    headless: false,
    executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    args: [
      '--no-sandbox', '--disable-setuid-sandbox', '--ignore-certificate-errors',
      '--window-size=1400,900', '--start-minimized',
      '--disable-blink-features=AutomationControlled',
      '--no-first-run', '--no-default-browser-check'
    ],
    defaultViewport: { width: 1400, height: 900 }
  });
}

async function closeBrowser(browser) {
  try { await browser.close(); } catch(e) {}
  await new Promise(r => setTimeout(r, 2000));
  cleanPuppeteerProfiles();
}

// ─────────────────────────────────────────────────────────────
// Login ANAPEC (même méthode que scraper v7)
// ─────────────────────────────────────────────────────────────
async function loginAnapec(browser, email, password) {
  const page = await browser.newPage();
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

  await page.goto(HOME_URL, { waitUntil: 'networkidle2', timeout: 60000 });
  await new Promise(r => setTimeout(r, 4000));

  // Radio Employeur
  try {
    await page.waitForSelector('#radio_1', { timeout: 5000 });
    await page.click('#radio_1');
  } catch(e) {
    await page.evaluate(() => {
      const all = document.querySelectorAll('input[type="radio"]');
      if (all.length >= 2) all[1].click();
    });
  }
  await new Promise(r => setTimeout(r, 2000));

  const userSel = '#user, input[name="data[cherch_empl][identifiant]"], input[name="data[Entreprise][identifiant]"]';
  await page.waitForSelector(userSel, { visible: true, timeout: 10000 });
  await page.click(userSel, { clickCount: 3 });
  await page.type(userSel, email, { delay: 50 });

  const passSel = '#pass, input[name="data[cherch_empl][mot_pass]"], input[name="data[Entreprise][mot_pass]"]';
  await page.waitForSelector(passSel, { visible: true, timeout: 5000 });
  await page.click(passSel, { clickCount: 3 });
  await page.type(passSel, password, { delay: 50 });

  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }).catch(() => {}),
    page.keyboard.press('Enter')
  ]);
  await new Promise(r => setTimeout(r, 3000));

  const isConnected = await page.evaluate(() =>
    document.body.textContent.includes('Déconnexion') ||
    document.body.textContent.includes('Bienvenue') ||
    document.body.textContent.includes('Votre espace')
  );

  if (!isConnected) { await page.close(); return null; }
  return page;
}

// ─────────────────────────────────────────────────────────────
// isArabicContent
// ─────────────────────────────────────────────────────────────
function isArabicContent(text) {
  const arabicChars = (text.match(/[\u0600-\u06FF]/g) || []).length;
  const totalNonSpace = text.replace(/\s/g, '').length;
  if (totalNonSpace === 0) return false;
  if (arabicChars / totalNonSpace > 0.05) return true;
  return text.includes('لمدة') || text.includes('مبلغها') ||
         text.includes('تعيين') || text.includes('المتدرب');
}

function isArabicHtml(html) {
  return isArabicContent(html.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' '));
}

// ─────────────────────────────────────────────────────────────
// isUnsigned — v8: ARABE + FRANÇAIS
// ─────────────────────────────────────────────────────────────
function isUnsigned(html) {
  if (html.length < 15000) return false;

  const arabic = isArabicHtml(html);

  if (arabic) {
    const tables = html.match(/<table[\s\S]*?<\/table>/gi) || [];
    for (const table of tables) {
      if (!table.match(/المشغل|المتدرب/i)) continue;
      const cells = table.match(/<td[^>]*>([\s\S]*?)<\/td>/gi) || [];
      if (cells.length < 2) continue;
      const contentCells = cells.filter(td => {
        const h = td.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, '').trim();
        return !h.match(/المشغل|المتدرب|تأشيرة/);
      });
      if (contentCells.length === 0) continue;
      const allEmpty = contentCells.every(td => {
        const c = td.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, '').replace(/\s+/g, '').trim();
        return c.length === 0;
      });
      if (allEmpty) return true;
    }
    return false;
  } else {
    const sigIdxFr = html.search(/L.employeur[\s\S]{0,150}Le stagiaire/i);
    if (sigIdxFr >= 0) {
      const zone = html.substring(sigIdxFr, sigIdxFr + 800);
      const tdAll = zone.match(/<td[^>]*>([\s\S]*?)<\/td>/gi) || [];
      const sigCells = tdAll.slice(3, 6);
      const contents = sigCells.map(td =>
        td.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, '').replace(/\s+/g, '').trim()
      );
      if (sigCells.length >= 2) return contents.every(c => c.length === 0);
    }
    if (html.match(/Fait\s+[àa]\s*[.……]+/i)) return true;
    return false;
  }
}

// ─────────────────────────────────────────────────────────────
// extractId / extractRef
// ─────────────────────────────────────────────────────────────
function extractId(filename) {
  const m = filename.match(/ci_(\d+)\.html/);
  return m ? m[1] : null;
}

function extractRef(html) {
  const m = html.match(/\b([A-Z]{0,3}\d{8,}\/\d+)\b/);
  return m ? m[1].replace(/\//g, '-') : 'REF_INCONNUE';
}

// ─────────────────────────────────────────────────────────────
// Générer le PDF d'un contrat depuis ANAPEC
// ─────────────────────────────────────────────────────────────
async function generatePdf(page, ciId, outputPath) {
  await page.goto(`${BASE_URL}/edition_ci/${ciId}`, { waitUntil: 'networkidle2', timeout: 30000 });

  // Détecter session expirée
  const currentUrl = page.url();
  if (currentUrl.includes('login') || currentUrl === HOME_URL || !currentUrl.includes('edition_ci')) {
    throw new Error('SESSION_EXPIRED');
  }

  try {
    await page.waitForFunction(
      () => {
        const el = document.querySelector('.printable, .arriereprintable');
        return el && el.innerHTML && el.innerHTML.length > 2000;
      },
      { timeout: 15000 }
    );
  } catch(e) {
    await new Promise(r => setTimeout(r, 2000));
  }

  await page.evaluate(() => {
    document.querySelectorAll(
      '.noPrint, button, .alert, nav, header, footer, #Print, ' +
      '.btn, [class*="btn-"], .navbar, .sidebar'
    ).forEach(el => el.style.display = 'none');
    document.querySelectorAll('.printable, .arriereprintable')
      .forEach(el => el.style.display = 'block');
  });

  await page.pdf({
    path: outputPath, format: 'A4', printBackground: true,
    margin: { top: '10mm', bottom: '10mm', left: '10mm', right: '10mm' },
  });
}

// ─────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2).map(a => a.toUpperCase());
  const societes = args.length > 0
    ? SOCIETES.filter(s => args.includes(s.nom))
    : SOCIETES;

  if (societes.length === 0) {
    console.log('❌ Société inconnue. Disponibles:', SOCIETES.map(s=>s.nom).join(', '));
    process.exit(1);
  }

  console.log('\n╔══════════════════════════════════════════════════╗');
  console.log('║  PDF_Contrats v8 — 1 PDF par contrat non signé   ║');
  console.log('╚══════════════════════════════════════════════════╝\n');

  if (!existsSync(PDF_DIR)) mkdirSync(PDF_DIR, { recursive: true });

  let totalGenerated = 0, totalSkipped = 0, totalErrors = 0;

  for (const societe of societes) {
    const societeDir = join(BASE_DIR, societe.nom);
    if (!existsSync(societeDir)) {
      console.log(`\n⚠️  ${societe.nom}: dossier introuvable → ignoré`);
      continue;
    }

    const files = readdirSync(societeDir).filter(f => f.startsWith('ci_') && f.endsWith('.html'));
    const unsignedFiles = [];
    for (const file of files) {
      const html = readFileSync(join(societeDir, file), 'utf8');
      if (isUnsigned(html)) {
        const id = extractId(file);
        const ref = extractRef(html);
        if (id) unsignedFiles.push({ file, id, ref });
      }
    }

    if (unsignedFiles.length === 0) {
      console.log(`\n━━━ ${societe.nom}: aucun contrat non signé`);
      continue;
    }

    console.log(`\n━━━ ${societe.nom} — ${unsignedFiles.length} contrats non signés`);

    const societeOutDir = join(PDF_DIR, societe.nom);
    if (!existsSync(societeOutDir)) mkdirSync(societeOutDir, { recursive: true });

    let browser = await launchBrowser();
    let page = await loginAnapec(browser, societe.email, societe.password);
    if (!page) {
      console.log(`  ❌ Connexion échouée pour ${societe.email}`);
      await closeBrowser(browser);
      continue;
    }
    console.log(`  ✅ Connecté: ${societe.email}`);

    let pdfCount = 0;

    for (const { id, ref } of unsignedFiles) {
      const pdfPath = join(societeOutDir, `${ref}.pdf`);

      if (existsSync(pdfPath)) {
        process.stdout.write(`  ⏭  ${ref}.pdf (déjà existant)\n`);
        totalSkipped++;
        continue;
      }

      // Restart browser préventif
      if (pdfCount > 0 && pdfCount % RESTART_EVERY === 0) {
        console.log(`  🔄 Restart browser préventif (${pdfCount} PDFs)...`);
        await closeBrowser(browser);
        await new Promise(r => setTimeout(r, 3000));
        browser = await launchBrowser();
        page = await loginAnapec(browser, societe.email, societe.password);
        if (!page) { console.log(`  ❌ Reconnexion échouée`); break; }
        console.log(`  ✅ Reconnecté`);
      }

      try {
        process.stdout.write(`  ⏳ ${ref}...`);
        await generatePdf(page, id, pdfPath);
        process.stdout.write(` ✅\n`);
        totalGenerated++; pdfCount++;
        await new Promise(r => setTimeout(r, 600));
      } catch(e) {
        if (e.message === 'SESSION_EXPIRED') {
          process.stdout.write(` 🔄 session expirée → reconnexion...\n`);
          await closeBrowser(browser);
          browser = await launchBrowser();
          page = await loginAnapec(browser, societe.email, societe.password);
          if (page) {
            try {
              await generatePdf(page, id, pdfPath);
              console.log(`  ✅ ${ref} (retry ok)`);
              totalGenerated++; pdfCount++;
            } catch(e2) {
              console.log(`  ❌ ${ref}: ${e2.message.substring(0,60)}`);
              totalErrors++;
            }
          } else {
            console.log(`  ❌ Reconnexion impossible`);
            totalErrors++; break;
          }
        } else {
          process.stdout.write(` ❌ ${e.message.substring(0,60)}\n`);
          totalErrors++;
        }
      }
    }

    await closeBrowser(browser);
  }

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

main().catch(e => { console.error('❌ ERREUR CRITIQUE:', e.message); process.exit(1); });
