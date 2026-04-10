// ============================================================
// sync_weekly.mjs - Sync GitHub Actions → Lambda → Monday
// Lit les données des 8 sociétés depuis GitHub et envoie à Lambda
// ============================================================

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';

const IS_GITHUB  = process.env.GITHUB_ACTIONS === 'true';
const BASE_DIR   = IS_GITHUB ? '.' : 'C:\\anapec';
const LAMBDA_URL = process.env.LAMBDA_URL || 'https://cel7jflv4gclxqw2ozvr2b46ku0dsczq.lambda-url.eu-north-1.on.aws/';
const LOG_FILE   = join(BASE_DIR, 'sync_log.txt');

// 8 sociétés
const SOCIETES = [
  'GRUPO_TEYEZ',
  'SIGARMOR',
  'EIM',
  'KIRKOS',
  'KIRKOS_GUARD',
  'NEISS',
  'NORIA_BIANCA',
  'CQ_SERVICE'
];

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

async function sendToLambda(contracts, societe) {
  try {
    const res = await fetch(LAMBDA_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contracts, societe })
    });
    const data = await res.json();
    if (res.ok && data.stats) {
      return data.stats;
    }
    log(`  ❌ Lambda erreur: ${JSON.stringify(data)}`);
    return { created: 0, updated: 0, errors: contracts.length };
  } catch(e) {
    log(`  ❌ Exception: ${e.message}`);
    return { created: 0, updated: 0, errors: contracts.length };
  }
}

async function processSociete(nom) {
  const societeDir = join(BASE_DIR, nom);
  const jsonPath   = join(societeDir, 'contrats.json');

  log(`\n━━━ ${nom} ━━━`);

  if (!existsSync(jsonPath)) {
    log(`  ⚠️ contrats.json introuvable — ignoré`);
    return { created: 0, updated: 0, errors: 0 };
  }

  const baseContracts = JSON.parse(readFileSync(jsonPath, 'utf8'));
  log(`  ${baseContracts.length} contrats`);

  if (baseContracts.length === 0) return { created: 0, updated: 0, errors: 0 };

  // Fusionner avec détails
  const files = readdirSync(societeDir).filter(f => f.startsWith('ci_') && f.endsWith('.html'));
  const detailMap = {};
  for (const file of files) {
    const html = readFileSync(join(societeDir, file), 'utf8');
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
    ref: c.ref || '', date_sig: c.date_sig || '', date_fin: c.date_fin || '',
    etat: c.etat || '', type: c.type || '', cin: c.cin || '',
    ...(detailMap[c.ref] || {})
  }));

  const stats = await sendToLambda(contracts, nom);
  log(`  ✅ +${stats.created} créés, ↻${stats.updated} mis à jour, ✗${stats.errors} erreurs`);
  return stats;
}

async function main() {
  log('╔══════════════════════════════════════════════════╗');
  log('║  SYNC GitHub Actions → Lambda → Monday.com      ║');
  log('╚══════════════════════════════════════════════════╝');

  let totalCreated = 0, totalUpdated = 0, totalErrors = 0;

  for (const nom of SOCIETES) {
    const stats = await processSociete(nom);
    totalCreated += stats.created || 0;
    totalUpdated += stats.updated || 0;
    totalErrors  += stats.errors  || 0;
    await new Promise(r => setTimeout(r, 1000));
  }

  log('\n╔══════════════════════════════════════════════════╗');
  log(`║  FIN: +${totalCreated} créés, ↻${totalUpdated} mis à jour, ✗${totalErrors} erreurs  ║`);
  log('╚══════════════════════════════════════════════════╝');
}

main().catch(e => {
  log(`ERREUR CRITIQUE: ${e.message}`);
  process.exit(1);
});
