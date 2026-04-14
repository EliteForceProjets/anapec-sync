// ============================================================
// Export_PDF.mjs — Génération PDF des contrats non signés
//
// FONCTIONNEMENT :
//   1. Lit les fichiers HTML dans C:\anapec\SOCIETE\ci_*.html
//   2. Détecte les contrats non signés (cases signature vides)
//   3. Génère un seul fichier PDF : C:\anapec\contrats_non_signes.pdf
//
// USAGE :
//   node C:\anapec\Export_PDF.mjs
//   node C:\anapec\Export_PDF.mjs KIRKOS          ← une seule société
//   node C:\anapec\Export_PDF.mjs KIRKOS NEISS    ← plusieurs sociétés
// ============================================================

import puppeteer from 'puppeteer';
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';

const BASE_DIR  = 'C:\\anapec';
const OUTPUT_PDF = join(BASE_DIR, 'contrats_non_signes.pdf');

// Sociétés à traiter (toutes par défaut, ou filtrées via args)
const ALL_SOCIETES = [
  'GRUPO_TEYEZ',
  'SIGARMOR',
  'EIM',
  'KIRKOS',
  'KIRKOS_GUARD',
  'NEISS',
  'NORIA_BIANCA',
  'CQ_SERVICE',
];

// ─────────────────────────────────────────────────────────────
// Détecter si un contrat est non signé
// Les cases L'employeur / Le stagiaire / VISA sont vides
// ─────────────────────────────────────────────────────────────
function isUnsigned(html) {
  // Vérifier que c'est bien un contrat avec zone de signature
  if (!html.match(/Fait\s+[àa]/i) && !html.match(/الموقعين/i)) {
    return false; // fichier vide ou template sans contenu
  }

  // Méthode 1 : tableau signature français
  // L'employeur | Le stagiaire | VISA par l'ANAPEC
  const sigIdxFr = html.search(/L.employeur[\s\S]{0,150}Le stagiaire/i);
  if (sigIdxFr >= 0) {
    const zone = html.substring(sigIdxFr, sigIdxFr + 800);
    const tdAll = zone.match(/<td[^>]*>([\s\S]*?)<\/td>/gi) || [];
    // Sauter les 3 td headers → prendre les 3 td de contenu (signatures)
    const sigCells = tdAll.slice(3, 6);
    const contents = sigCells.map(td =>
      td.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, '').replace(/\s+/g, '').trim()
    );
    if (sigCells.length >= 2) {
      return contents.every(c => c.length === 0);
    }
  }

  // Méthode 2 : tableau signature arabe
  // توقيع صاحب العمل | توقيع المتدرب
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

  // Si on trouve "Fait à" mais pas de tableau → considérer comme non signé
  if (html.match(/Fait\s+[àa]\s*[.……]+/i)) return true;

  return false;
}

// ─────────────────────────────────────────────────────────────
// Extraire la référence du contrat depuis le HTML
// ─────────────────────────────────────────────────────────────
function extractRef(html) {
  const m = html.match(/\b([A-Z]{0,3}\d{8,}\/\d+)\b/);
  return m ? m[1] : 'REF_INCONNUE';
}

// ─────────────────────────────────────────────────────────────
// Préparer le HTML d'un contrat pour impression PDF
// Ajouter un saut de page entre chaque contrat
// ─────────────────────────────────────────────────────────────
function prepareForPdf(html, ref, societe) {
  // Extraire le contenu entre <body> et </body>
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  const bodyContent = bodyMatch ? bodyMatch[1] : html;

  // Supprimer les scripts et styles inline non nécessaires
  const cleanContent = bodyContent
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/class="noPrint"[^>]*>[\s\S]*?<\/[^>]+>/gi, '')
    // Supprimer le bouton "Imprimer le Contrat d'Insertion"
    .replace(/<[^>]*id="Print"[^>]*>[\s\S]*?<\/[^>]+>/gi, '')
    .replace(/<button[^>]*>[\s\S]*?<\/button>/gi, '');

  return `
    <div class="contrat-page" style="page-break-after: always;">
      <div style="background:#f0f0f0; padding:6px 12px; margin-bottom:8px; font-size:11px; color:#555; border-left:3px solid #333;">
        <strong>Société :</strong> ${societe} &nbsp;|&nbsp;
        <strong>Réf :</strong> ${ref} &nbsp;|&nbsp;
        <strong>Statut :</strong> <span style="color:red">⚠ NON SIGNÉ</span>
      </div>
      ${cleanContent}
    </div>`;
}

// ─────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────
async function main() {
  // Filtrer les sociétés selon les arguments CLI
  const args = process.argv.slice(2).map(a => a.toUpperCase());
  const societes = args.length > 0
    ? ALL_SOCIETES.filter(s => args.includes(s))
    : ALL_SOCIETES;

  if (societes.length === 0) {
    console.log('❌ Aucune société valide. Disponibles:', ALL_SOCIETES.join(', '));
    process.exit(1);
  }

  console.log('\n╔══════════════════════════════════════════════════╗');
  console.log('║  EXPORT PDF — Contrats non signés                ║');
  console.log('╚══════════════════════════════════════════════════╝\n');
  console.log(`📂 Sociétés : ${societes.join(', ')}`);
  console.log(`📄 Sortie   : ${OUTPUT_PDF}\n`);

  let totalUnsigned = 0;
  let totalChecked  = 0;
  const pagesHtml   = [];

  // ── Parcourir chaque société
  for (const societe of societes) {
    const societeDir = join(BASE_DIR, societe);
    if (!existsSync(societeDir)) {
      console.log(`  ⚠️  ${societe}: dossier introuvable → ignoré`);
      continue;
    }

    const files = readdirSync(societeDir)
      .filter(f => f.startsWith('ci_') && f.endsWith('.html'));

    if (files.length === 0) {
      console.log(`  ⚠️  ${societe}: aucun fichier HTML`);
      continue;
    }

    let societeUnsigned = 0;
    process.stdout.write(`  ─── ${societe} (${files.length} fichiers) `);

    for (const file of files) {
      const html = readFileSync(join(societeDir, file), 'utf8');
      totalChecked++;

      if (isUnsigned(html)) {
        const ref = extractRef(html);
        pagesHtml.push(prepareForPdf(html, ref, societe));
        societeUnsigned++;
        totalUnsigned++;
      }
    }

    console.log(`→ ${societeUnsigned} non signés`);
  }

  console.log(`\n📊 Total vérifié  : ${totalChecked} contrats`);
  console.log(`📊 Non signés     : ${totalUnsigned} contrats`);

  if (totalUnsigned === 0) {
    console.log('\n✅ Tous les contrats sont signés ! Aucun PDF généré.');
    return;
  }

  // ── Générer le PDF
  console.log('\n⏳ Génération du PDF en cours...');

  // Construire le HTML complet
  const fullHtml = `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <title>Contrats non signés — ANAPEC</title>
  <style>
    @page {
      size: A4;
      margin: 15mm 10mm;
    }
    body {
      font-family: Arial, sans-serif;
      font-size: 12px;
      color: #000;
    }
    .contrat-page {
      page-break-after: always;
    }
    .contrat-page:last-child {
      page-break-after: avoid;
    }
    /* Page de garde */
    .cover-page {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 90vh;
      page-break-after: always;
      text-align: center;
    }
    img { max-width: 100%; }
    table { width: 100%; border-collapse: collapse; }
    td, th { padding: 4px; }
    /* Masquer les boutons et liens */
    button, a[href="#"] { display: none !important; }
    .noPrint { display: none !important; }
  </style>
</head>
<body>

  <!-- PAGE DE GARDE -->
  <div class="cover-page">
    <div style="border: 2px solid #333; padding: 40px; border-radius: 8px; max-width: 500px;">
      <h1 style="font-size:24px; margin-bottom:10px;">📋 ANAPEC</h1>
      <h2 style="font-size:18px; color:#c00;">Contrats Non Signés</h2>
      <hr style="margin: 20px 0;">
      <p style="font-size:14px;"><strong>${totalUnsigned} contrats</strong> en attente de signature</p>
      <p style="font-size:12px; color:#666;">Sociétés : ${societes.join(', ')}</p>
      <p style="font-size:11px; color:#999;">Généré le ${new Date().toLocaleDateString('fr-FR', {
        day: '2-digit', month: 'long', year: 'numeric',
        hour: '2-digit', minute: '2-digit'
      })}</p>
    </div>
  </div>

  <!-- CONTRATS -->
  ${pagesHtml.join('\n')}

</body>
</html>`;

  // Lancer Puppeteer pour générer le PDF
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  try {
    const page = await browser.newPage();
    await page.setContent(fullHtml, { waitUntil: 'networkidle0', timeout: 60000 });

    await page.pdf({
      path: OUTPUT_PDF,
      format: 'A4',
      printBackground: true,
      margin: { top: '15mm', bottom: '15mm', left: '10mm', right: '10mm' },
    });

    console.log(`\n✅ PDF généré avec succès !`);
    console.log(`📄 Fichier : ${OUTPUT_PDF}`);
    console.log(`📊 Pages   : ~${totalUnsigned + 1} pages (1 page de garde + ${totalUnsigned} contrats)`);
    console.log(`\n💡 Pour imprimer : ouvrez le fichier et lancez Ctrl+P`);

  } finally {
    await browser.close();
  }
}

main().catch(e => {
  console.error('❌ ERREUR:', e.message);
  process.exit(1);
});
