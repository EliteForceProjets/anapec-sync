// ============================================================
// run_all.mjs - Script principal complet
// 1. Scrape ANAPEC
// 2. Push données vers GitHub
// 3. Envoie vers Lambda → Monday.com
// ============================================================

import { execSync } from 'child_process';
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';

const OUT_DIR    = 'C:\\anapec';
const LAMBDA_URL = 'https://cel7jflv4gclxqw2ozvr2b46ku0dsczq.lambda-url.eu-north-1.on.aws/';
const LOG_FILE   = join(OUT_DIR, 'sync_log.txt');

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
    poste:      find(/المهنة[^:\n]*:\s*([^\n]{3,60})/),
    duree:      find(/المدة[^:\n]*:\s*(\d+)/),
    salaire:    find(/الأجر[^:\n]*:\s*([\d\s.,]+)/),
  };
}

async function sendToLambda(contracts) {
  log(`Envoi de ${contracts.length} contrats vers Lambda...`);
  const BATCH_SIZE = 50;
  let totalCreated = 0, totalUpdated = 0, totalErrors = 0;

  for (let i = 0; i < contracts.length; i += BATCH_SIZE) {
    const batch = contracts.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(contracts.length / BATCH_SIZE);
    log(`Lot ${batchNum}/${totalBatches}...`);

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
        log(`  ✅ +${data.stats.created} créés, ↻${data.stats.updated} mis à jour`);
      } else {
        log(`  ❌ ${JSON.stringify(data)}`);
        totalErrors += batch.length;
      }
    } catch(e) {
      log(`  ❌ ${e.message}`);
      totalErrors += batch.length;
    }

    if (i + BATCH_SIZE < contracts.length) await new Promise(r => setTimeout(r, 1000));
  }
  return { created: totalCreated, updated: totalUpdated, errors: totalErrors };
}

async function main() {
  log('╔══════════════════════════════════════════╗');
  log('║  PIPELINE COMPLET ANAPEC → Monday.com   ║');
  log('╚══════════════════════════════════════════╝');

  // ── ÉTAPE 1 : Scraping ANAPEC ─────────────────────────────
  log('');
  log('━━━ ÉTAPE 1 : Scraping ANAPEC ━━━━━━━━━━━━');
  try {
    execSync('node C:\\anapec\\scraper_anapec.mjs', { stdio: 'inherit', timeout: 300000 });
    log('✅ Scraping terminé');
  } catch(e) {
    log(`❌ Erreur scraping: ${e.message}`);
    log('Tentative avec données existantes...');
  }

  // ── ÉTAPE 2 : Push vers GitHub ────────────────────────────
  log('');
  log('━━━ ÉTAPE 2 : Push données vers GitHub ━━━');
  try {
    const date = new Date().toLocaleString('fr-FR');
    execSync(`cd C:\\anapec && git add contrats.json ci_*.html && git commit -m "Données ANAPEC - ${date}" && git push origin main`, 
      { stdio: 'inherit', timeout: 60000 });
    log('✅ Données pushées vers GitHub');
  } catch(e) {
    log(`⚠️ Git push: ${e.message.substring(0, 100)}`);
    log('Continuation avec sync Lambda...');
  }

  // ── ÉTAPE 3 : Préparer et envoyer à Lambda ────────────────
  log('');
  log('━━━ ÉTAPE 3 : Sync vers Monday via Lambda ━');

  const jsonPath = join(OUT_DIR, 'contrats.json');
  if (!existsSync(jsonPath)) {
    log('❌ contrats.json introuvable !');
    return;
  }

  const baseContracts = JSON.parse(readFileSync(jsonPath, 'utf8'));
  log(`${baseContracts.length} contrats dans contrats.json`);

  const files = readdirSync(OUT_DIR).filter(f => f.startsWith('ci_') && f.endsWith('.html'));
  log(`${files.length} fichiers détails`);

  const detailMap = {};
  for (const file of files) {
    const html = readFileSync(join(OUT_DIR, file), 'utf8');
    const detail = parseDetail(html);
    const refMatch = html.replace(/<[^>]+>/g,' ').match(/([AI]?\d{10,}\/\d+)/);
    let ref = refMatch?.[1] || '';
    if (ref.match(/^I\d/)) ref = 'A' + ref;
    if (ref) {
      detailMap[ref] = detail;
      detailMap[ref.replace(/^A/,'')] = detail;
    }
  }

  const contracts = baseContracts.map(c => ({
    ref:      c.ref      || '',
    date_sig: c.date_sig || '',
    date_fin: c.date_fin || '',
    etat:     c.etat     || '',
    type:     c.type     || '',
    cin:      c.cin      || '',
    ...(detailMap[c.ref] || {})
  }));

  const stats = await sendToLambda(contracts);

  log('');
  log('╔══════════════════════════════════════════╗');
  log(`║  FIN: +${stats.created} créés, ↻${stats.updated} mis à jour, ✗${stats.errors} erreurs  ║`);
  log('╚══════════════════════════════════════════╝');
}

main().catch(e => {
  log(`ERREUR CRITIQUE: ${e.message}`);
  process.exit(1);
});
