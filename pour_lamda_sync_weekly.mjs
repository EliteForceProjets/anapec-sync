// ============================================================
// sync_weekly.mjs - Pipeline complet ANAPEC → Lambda → Monday
// Étape 1 : Scrape ANAPEC automatiquement
// Étape 2 : Envoie les contrats à Lambda → Monday.com
// S'exécute automatiquement chaque dimanche à 8h00
// ============================================================

import { readFileSync, readdirSync, writeFileSync, existsSync } from 'fs';
import { execSync } from 'child_process';

const LAMBDA_URL = 'https://cel7jflv4gclxqw2ozvr2b46ku0dsczq.lambda-url.eu-north-1.on.aws/';
const LOG_FILE   = 'C:\\anapec\\sync_log.txt';
const SCRAPER    = 'C:\\anapec\\scraper_anapec.mjs';

function log(msg) {
  const line = `[${new Date().toLocaleString('fr-FR')}] ${msg}`;
  console.log(line);
  try {
    const existing = existsSync(LOG_FILE) ? readFileSync(LOG_FILE, 'utf8') : '';
    writeFileSync(LOG_FILE, existing + line + '\n');
  } catch(e) {}
}

function parseDetail(html) {
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/td>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/[ \t]+/g, ' ');

  const find = (...patterns) => {
    for (const p of patterns) {
      const m = text.match(p);
      if (m?.[1]?.trim()) return m[1].trim();
    }
    return '';
  };

  return {
    agence:     find(/الوكالة\s*:\s*([^\n|]{3,60})/),
    nom_entrep: find(/الاسم [أا]و المقاول[^:\n]*:\s*([^\n]{3,80})/) || (text.match(/GRUPO[^\n,]*/)?.[0] || ''),
    secteur:    find(/قطاع النشاط[^:\n]*:\s*([^\n]{3,80})/) || (text.match(/Services fournis[^\n]*/)?.[0] || ''),
    adresse:    find(/العنوان\s*:\s*([^\n]{5,150})/),
    telephone:  find(/(0\d{8,9})/),
    rc:         find(/رقم القيد في السجل التجاري[^:\n]*:\s*(\d+)/),
    cnss_empl:  find(/رقم الانخراط[^:\n]*:\s*(\d+)/),
    forme_jur:  find(/النظام القانوني[^:\n]*:\s*([^\n]{3,60})/),
    nom_agent:  find(/الاسم العائلي[^:\n]*:\s*([^\n]{2,40})/),
    prenom:     find(/الاسم الشخصي[^:\n]*:\s*([^\n]{2,40})/),
    nationalite:find(/الجنسية[^:\n]*:\s*([^\n]{3,30})/),
    cin:        text.match(/\b([A-Z]{1,2}\d{5,8})\b/)?.[1] || '',
    cnss_agent: find(/رقم التسجيل بالصندوق[^:\n]*:\s*(\d{6,12})/),
    niveau:     find(/المستوى التعليمي[^:\n]*:\s*([^\n]{3,60})/),
    poste:      find(/المهنة[^:\n]*:\s*([^\n]{3,60})/, /agent de nettoyage/i),
    duree:      find(/المدة[^:\n]*:\s*(\d+)/),
    salaire:    find(/الأجر[^:\n]*:\s*([\d\s.,]+)/),
  };
}

async function runScraper() {
  log('--- Étape 1 : Scraping ANAPEC ---');
  if (!existsSync(SCRAPER)) {
    log('ERREUR: scraper_anapec.mjs introuvable dans C:\\anapec\\');
    return false;
  }
  try {
    log('Lancement du scraper...');
    execSync(`node ${SCRAPER}`, { stdio: 'inherit', timeout: 300000 });
    log('✅ Scraping terminé avec succès');
    return true;
  } catch(e) {
    log(`❌ Erreur scraping: ${e.message}`);
    log('Tentative de continuer avec les données existantes...');
    return false;
  }
}

async function sendToLambda(contracts) {
  log(`Envoi de ${contracts.length} contrats vers Lambda...`);
  const BATCH_SIZE = 50;
  let totalCreated = 0, totalUpdated = 0, totalErrors = 0;

  for (let i = 0; i < contracts.length; i += BATCH_SIZE) {
    const batch = contracts.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(contracts.length / BATCH_SIZE);
    log(`Lot ${batchNum}/${totalBatches} (${batch.length} contrats)...`);

    try {
      const res = await fetch(LAMBDA_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contracts: batch })
      });
      const data = await res.json();
      if (res.ok && data.stats) {
        totalCreated += data.stats.created || 0;
        totalUpdated += data.stats.updated || 0;
        totalErrors  += data.stats.errors  || 0;
        log(`  ✅ Lot ${batchNum}: +${data.stats.created} créés, ↻${data.stats.updated} mis à jour, ✗${data.stats.errors} erreurs`);
      } else {
        log(`  ❌ Lot ${batchNum} erreur: ${JSON.stringify(data)}`);
        totalErrors += batch.length;
      }
    } catch(e) {
      log(`  ❌ Lot ${batchNum} exception: ${e.message}`);
      totalErrors += batch.length;
    }

    if (i + BATCH_SIZE < contracts.length) await new Promise(r => setTimeout(r, 1000));
  }
  return { created: totalCreated, updated: totalUpdated, errors: totalErrors };
}

async function main() {
  log('========================================');
  log('=== Début pipeline ANAPEC → Monday.com ===');
  log('=== Scraper → Lambda → Monday ===');

  try {
    // Étape 1 : Scraper ANAPEC
    await runScraper();

    // Étape 2 : Lire contrats.json
    log('--- Étape 2 : Lecture des données ---');
    if (!existsSync('C:\\anapec\\contrats.json')) {
      log('ERREUR: contrats.json non trouvé même après scraping !');
      return;
    }
    const baseContracts = JSON.parse(readFileSync('C:\\anapec\\contrats.json', 'utf8'));
    log(`${baseContracts.length} contrats dans contrats.json`);

    // Étape 3 : Lire fichiers détails
    const files = readdirSync('C:\\anapec\\').filter(f => f.startsWith('ci_') && f.endsWith('.html'));
    log(`${files.length} fichiers détails trouvés`);

    const detailMap = {};
    for (const file of files) {
      const html = readFileSync(`C:\\anapec\\${file}`, 'utf8');
      const detail = parseDetail(html);
      const refMatch = html.replace(/<[^>]+>/g,' ').match(/([AI]?\d{10,}\/\d+)/);
      let ref = refMatch?.[1] || '';
      if (ref.match(/^I\d/)) ref = 'A' + ref;
      if (ref) {
        detailMap[ref] = detail;
        detailMap[ref.replace(/^A/,'')] = detail;
      }
    }

    // Étape 4 : Fusionner
    const contracts = baseContracts.map(c => ({
      ref:      c.ref      || '',
      date_sig: c.date_sig || '',
      date_fin: c.date_fin || '',
      etat:     c.etat     || '',
      type:     c.type     || '',
      cin:      c.cin      || '',
      ...(detailMap[c.ref] || {})
    }));
    log(`${contracts.length} contrats prêts à synchroniser`);

    // Étape 5 : Envoyer à Lambda
    log('--- Étape 3 : Envoi vers Lambda → Monday ---');
    const stats = await sendToLambda(contracts);

    log(`=== FIN: +${stats.created} créés, ↻${stats.updated} mis à jour, ✗${stats.errors} erreurs ===`);
    log('========================================');

  } catch(error) {
    log(`ERREUR CRITIQUE: ${error.message}`);
  }
}

main();
