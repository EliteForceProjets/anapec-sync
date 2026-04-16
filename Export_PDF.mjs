// ============================================================
// Export_PDF.mjs — Génération PDF des contrats non signés
// v9 - FIX TIMEOUT: génération par lots de 20 contrats
//      (602 contrats d'un coup = timeout Puppeteer)
//      Chaque lot → PDF temporaire → fusion finale avec pdf-lib
//
// USAGE :
//   node C:\anapec\Export_PDF.mjs
//   node C:\anapec\Export_PDF.mjs KIRKOS
//   node C:\anapec\Export_PDF.mjs KIRKOS NEISS
// ============================================================

import puppeteer from 'puppeteer';
import { readFileSync, writeFileSync, existsSync, readdirSync, unlinkSync } from 'fs';
import { join } from 'path';
import { createRequire } from 'module';

const BASE_DIR    = 'C:\\anapec';
const OUTPUT_PDF  = join(BASE_DIR, 'contrats_non_signes.pdf');
const TEMP_DIR    = BASE_DIR;
const LOT_SIZE    = 20; // contrats par lot

const ALL_SOCIETES = [
  'GRUPO_TEYEZ', 'SIGARMOR', 'EIM', 'KIRKOS',
  'KIRKOS_GUARD', 'NEISS', 'NORIA_BIANCA', 'CQ_SERVICE',
];

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
// isUnsigned v8 — ARABE + FRANÇAIS
// ─────────────────────────────────────────────────────────────
function isUnsigned(html) {
  if (html.length < 15000) return false;

  if (isArabicHtml(html)) {
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
      const allEmpty = contentCells.every(td =>
        td.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, '').replace(/\s+/g, '').trim().length === 0
      );
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

function extractRef(html) {
  const m = html.match(/\b([A-Z]{0,3}\d{8,}\/\d+)\b/);
  return m ? m[1] : 'REF_INCONNUE';
}

function prepareForPdf(html, ref, societe) {
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  const bodyContent = bodyMatch ? bodyMatch[1] : html;
  // Supprimer div#jGrowl (popup "Veuillez utiliser Recto verso")
  // avec greedy: tout ce qui suit est scripts/popups inutiles
  let cleanContent = bodyContent
    .replace(/<div[^>]*id=["']jGrowl["'][^>]*>[\s\S]*/i, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<button[^>]*>[\s\S]*?<\/button>/gi, '')
    .replace(/<[^>]*id=["']Print["'][^>]*>[\s\S]*?<\/[^>]+>/gi, '')
    .replace(/class=["']noPrint["'][^>]*>[\s\S]*?<\/[^>]+>/gi, '')
    .replace(/<link[^>]*>/gi, '')       // supprimer CSS externes
    .replace(/×/g, '');                  // supprimer le × du bouton close jGrowl

  const arabic = isArabicHtml(html);
  const dir = arabic ? 'rtl' : 'ltr';
  const font = arabic
    ? 'Arial, "Traditional Arabic", "Simplified Arabic", sans-serif'
    : 'Arial, sans-serif';

  return `
    <div class="contrat-page" style="page-break-after:always;direction:${dir};font-family:${font};">
      <div style="background:#f0f0f0;padding:5px 10px;margin-bottom:6px;font-size:10px;color:#555;border-left:3px solid #c00;direction:ltr;font-family:Arial,sans-serif;">
        <strong>Société:</strong> ${societe} | <strong>Réf:</strong> ${ref} |
        <span style="color:red;font-weight:bold;">⚠ NON SIGNÉ</span>
      </div>
      ${cleanContent}
    </div>`;
}

// ─────────────────────────────────────────────────────────────
// Générer un PDF pour un lot de contrats
// Retourne le buffer PDF
// ─────────────────────────────────────────────────────────────
async function generateLotPdf(browser, pages, lotNum, total) {
  const html = `<!DOCTYPE html>
<html><head>
  <meta charset="UTF-8">
  <style>
    @page { size: A4; margin: 12mm 10mm; }
    body { font-family: Arial, sans-serif; font-size: 11px; color: #000; margin: 0; }
    /* === 1 PAGE PAR CONTRAT === */
    .contrat-page {
      page-break-before: always;
      page-break-after: always;
      page-break-inside: avoid;
      overflow: hidden;
      /* Réduire le contenu pour tenir sur 1 page A4 */
      font-size: 9px !important;
      line-height: 1.3 !important;
      max-height: 257mm; /* hauteur utile A4 avec marges */
    }
    .contrat-page:first-child { page-break-before: avoid; }
    .contrat-page:last-child  { page-break-after: avoid; }
    /* Réduire toutes les polices dans le contrat */
    .contrat-page * {
      font-size: 9px !important;
      line-height: 1.3 !important;
      margin-top: 2px !important;
      margin-bottom: 2px !important;
      padding-top: 1px !important;
      padding-bottom: 1px !important;
    }
    .contrat-page h1, .contrat-page h2, .contrat-page h3 {
      font-size: 10px !important;
    }
    img { max-width: 80px !important; max-height: 40px !important; }
    table { width: 100%; border-collapse: collapse; }
    td, th { padding: 2px 3px !important; font-size: 8.5px !important; }
    button, .noPrint, #Print { display: none !important; }
    [dir="rtl"] { direction: rtl; unicode-bidi: embed; }
  </style>
</head><body>${pages.join('\n')}</body></html>`;

  const page = await browser.newPage();
  try {
    await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: 60000 });
    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '12mm', bottom: '12mm', left: '10mm', right: '10mm' },
    });
    process.stdout.write(` ✅ lot ${lotNum} (${pages.length} contrats)\n`);
    return pdfBuffer;
  } finally {
    await page.close();
  }
}

// ─────────────────────────────────────────────────────────────
// Fusionner plusieurs buffers PDF avec pdf-lib
// ─────────────────────────────────────────────────────────────
async function mergePdfs(pdfBuffers, coverBuffer) {
  // Utiliser require dynamique pour pdf-lib (CommonJS ou ESM)
  let PDFDocument;
  try {
    const pdfLib = await import('pdf-lib');
    PDFDocument = pdfLib.PDFDocument;
  } catch(e) {
    // Fallback: concaténer les buffers directement (moins propre mais fonctionnel)
    console.log('  ⚠️  pdf-lib non disponible → concaténation directe');
    const totalLen = [coverBuffer, ...pdfBuffers].reduce((a, b) => a + b.length, 0);
    const merged = Buffer.concat([coverBuffer, ...pdfBuffers], totalLen);
    return merged;
  }

  const mergedDoc = await PDFDocument.create();

  // Ajouter la page de garde
  const coverDoc = await PDFDocument.load(coverBuffer);
  const coverPages = await mergedDoc.copyPages(coverDoc, coverDoc.getPageIndices());
  coverPages.forEach(p => mergedDoc.addPage(p));

  // Ajouter chaque lot
  for (const buf of pdfBuffers) {
    const doc = await PDFDocument.load(buf);
    const docPages = await mergedDoc.copyPages(doc, doc.getPageIndices());
    docPages.forEach(p => mergedDoc.addPage(p));
  }

  return Buffer.from(await mergedDoc.save());
}

// ─────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2).map(a => a.toUpperCase());
  const societes = args.length > 0
    ? ALL_SOCIETES.filter(s => args.includes(s))
    : ALL_SOCIETES;

  if (societes.length === 0) {
    console.log('❌ Aucune société valide. Disponibles:', ALL_SOCIETES.join(', '));
    process.exit(1);
  }

  console.log('\n╔══════════════════════════════════════════════════╗');
  console.log('║  EXPORT PDF v9 — Contrats non signés (par lots)  ║');
  console.log('╚══════════════════════════════════════════════════╝\n');
  console.log(`📂 Sociétés : ${societes.join(', ')}`);
  console.log(`📄 Sortie   : ${OUTPUT_PDF}`);
  console.log(`📦 Lot size : ${LOT_SIZE} contrats par lot\n`);

  // ── Collecter tous les contrats non signés
  let totalChecked = 0, totalArabic = 0, totalFrench = 0;
  const allPages = []; // { html, ref, societe }

  for (const societe of societes) {
    const societeDir = join(BASE_DIR, societe);
    if (!existsSync(societeDir)) {
      console.log(`  ⚠️  ${societe}: dossier introuvable → ignoré`);
      continue;
    }
    const files = readdirSync(societeDir).filter(f => f.startsWith('ci_') && f.endsWith('.html'));
    if (files.length === 0) { console.log(`  ⚠️  ${societe}: aucun fichier HTML`); continue; }

    // ── Condition 1: état ANAPEC = Projet ou En cours (depuis contrats.json)
    // IMPORTANT: distinguer 2 cas :
    //   CAS A: contrats.json ABSENT → jsonChargé=false → fallback, accepte tout
    //   CAS B: contrats.json PRÉSENT mais 0 Projet → rejette tout (société sans Projet)
    const jsonPath = join(societeDir, 'contrats.json');
    const etatProjetSet = new Set();
    let jsonCharge = false; // true si contrats.json lu avec succès
    if (existsSync(jsonPath)) {
      try {
        const contrats = JSON.parse(readFileSync(jsonPath, 'utf8'));
        jsonCharge = true;
        // FIX: NE PAS ajouter le CIN dans etatProjetSet
        // Le CIN est partagé entre plusieurs contrats (renouvellements)
        // → un Validé&Signé avec le même CIN qu'un Projet serait inclus à tort (faux positif)
        // On n'utilise que detail_id et ref qui sont uniques par contrat
        const projetsRefsSet = new Set(); // refs des contrats Projet (pour log)
        for (const c of contrats) {
          const etat = (c.etat || '').toLowerCase();
          if (etat.includes('projet') || etat.includes('en cours') || etat.includes('cours')) {
            if (c.detail_id) etatProjetSet.add(String(c.detail_id));
            if (c.ref)       etatProjetSet.add(c.ref);
            // CIN délibérément exclu: trop risqué (partagé entre contrats)
            projetsRefsSet.add(c.ref || c.detail_id || '?');
          }
        }
        console.log(`  📋 ${projetsRefsSet.size} contrat(s) Projet/En cours sur ${contrats.length}`);

        // CAS B: json chargé mais 0 Projet → société sans contrat à générer
        if (etatProjetSet.size === 0) {
          console.log(`  ⏭  ${societe}: aucun contrat Projet/En cours → ignoré`);
          continue;
        }

        // Log des contrats Projet dont le HTML est absent (non encore scrappé)
        const htmlFiles = new Set(
          readdirSync(societeDir)
            .filter(f => f.startsWith('ci_') && f.endsWith('.html'))
            .map(f => f.replace('ci_','').replace('.html',''))
        );
        for (const c of contrats) {
          const etat = (c.etat || '').toLowerCase();
          if ((etat.includes('projet') || etat.includes('en cours')) && c.detail_id) {
            if (!htmlFiles.has(String(c.detail_id))) {
              console.log(`  ⚠️  HTML manquant: ${c.ref} (detail_id=${c.detail_id}) → relancer scraper`);
            }
          }
        }
      } catch(e) {
        console.log(`  ⚠️  Erreur lecture contrats.json: ${e.message}`);
      }
    } else {
      console.log(`  ⚠️  contrats.json absent → filtre état désactivé`);
    }

    let societeUnsigned = 0;
    process.stdout.write(`  ─── ${societe} (${files.length} fichiers) `);

    for (const file of files) {
      const html = readFileSync(join(societeDir, file), 'utf8');
      totalChecked++;

      const fileId = file.replace('ci_', '').replace('.html', '');
      const ref = extractRef(html);

      // Condition 1: état Projet/En cours — uniquement par detail_id ou ref (pas CIN)
      const etatOk = !jsonCharge ||
                     etatProjetSet.has(fileId) ||
                     etatProjetSet.has(ref);

      // Condition 2: signatures vides dans le HTML
      const signaturesVides = isUnsigned(html);

      if (etatOk && signaturesVides) {
        allPages.push({ html, ref, societe });
        societeUnsigned++;
        if (isArabicHtml(html)) totalArabic++; else totalFrench++;
      }
    }
    console.log(`→ ${societeUnsigned} retenus (Projet/En cours + signatures vides)`);
  }

  const totalUnsigned = allPages.length;
  console.log(`\n📊 Total vérifié  : ${totalChecked} contrats`);
  console.log(`📊 Non signés     : ${totalUnsigned} (${totalArabic} arabes, ${totalFrench} français)`);

  if (totalUnsigned === 0) {
    console.log('\n✅ Tous les contrats sont signés ! Aucun PDF généré.');
    return;
  }

  const nbLots = Math.ceil(totalUnsigned / LOT_SIZE);
  console.log(`\n⏳ Génération en ${nbLots} lots de ${LOT_SIZE} contrats...\n`);

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--font-render-hinting=none']
  });

  const pdfBuffers = [];

  try {
    // ── Page de garde
    process.stdout.write(`  → Page de garde...`);
    const coverHtml = `<!DOCTYPE html>
<html><head><meta charset="UTF-8">
<style>
  @page { size: A4; margin: 0; }
  body { font-family: Arial, sans-serif; display: flex; align-items: center;
         justify-content: center; height: 100vh; margin: 0; background: #fff; }
</style></head>
<body>
  <div style="border:2px solid #333;padding:50px;border-radius:10px;max-width:450px;text-align:center;">
    <h1 style="font-size:26px;margin-bottom:10px;">📋 ANAPEC</h1>
    <h2 style="font-size:20px;color:#c00;margin-bottom:20px;">Contrats Non Signés</h2>
    <hr style="margin:20px 0;border-color:#ccc;">
    <p style="font-size:15px;"><strong>${totalUnsigned} contrats</strong> en attente de signature</p>
    <p style="font-size:13px;color:#555;margin-top:8px;">dont ${totalArabic} arabes et ${totalFrench} français</p>
    <p style="font-size:12px;color:#666;margin-top:12px;">Sociétés : ${societes.join(', ')}</p>
    <p style="font-size:11px;color:#999;margin-top:16px;">Généré le ${new Date().toLocaleDateString('fr-FR',{
      day:'2-digit',month:'long',year:'numeric',hour:'2-digit',minute:'2-digit'
    })}</p>
  </div>
</body></html>`;

    const coverPage = await browser.newPage();
    await coverPage.setContent(coverHtml, { waitUntil: 'domcontentloaded', timeout: 15000 });
    const coverBuffer = await coverPage.pdf({
      format: 'A4', printBackground: true,
      margin: { top: '0', bottom: '0', left: '0', right: '0' }
    });
    await coverPage.close();
    console.log(' ✅\n');

    // ── Générer les lots
    for (let i = 0; i < nbLots; i++) {
      const lotItems = allPages.slice(i * LOT_SIZE, (i + 1) * LOT_SIZE);
      const lotPages = lotItems.map(({ html, ref, societe }) => prepareForPdf(html, ref, societe));
      process.stdout.write(`  → Lot ${i+1}/${nbLots} (contrats ${i*LOT_SIZE+1}–${Math.min((i+1)*LOT_SIZE, totalUnsigned)})...`);
      const lotBuffer = await generateLotPdf(browser, lotPages, i+1, nbLots);
      pdfBuffers.push(lotBuffer);
    }

    // ── Fusionner tous les PDFs
    console.log('\n⏳ Fusion des PDFs...');
    const finalPdf = await mergePdfs(pdfBuffers, coverBuffer);
    writeFileSync(OUTPUT_PDF, finalPdf);

    console.log(`\n✅ PDF généré avec succès !`);
    console.log(`📄 Fichier : ${OUTPUT_PDF}`);
    console.log(`📊 ~${totalUnsigned + 1} pages (1 couverture + ${totalUnsigned} contrats)`);
    console.log(`💡 Pour imprimer : ouvrez le fichier et Ctrl+P`);

  } finally {
    await browser.close();
  }
}

main().catch(e => { console.error('❌ ERREUR:', e.message); process.exit(1); });
