// ============================================================
// run_all.mjs - Pipeline complet pour les 8 sociétés
// ============================================================

import { execSync } from 'child_process';
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'fs';
import { join } from 'path';

const LAMBDA_URL = 'https://cel7jflv4gclxqw2ozvr2b46ku0dsczq.lambda-url.eu-north-1.on.aws/';
const BASE_DIR   = 'C:\\anapec';
const LOG_FILE   = join(BASE_DIR, 'sync_log.txt');

// ── Configuration des 8 sociétés ─────────────────────────────
const SOCIETES = [
  { nom: 'GRUPO_TEYEZ',  email: 'grupoteyez@gmail.com',            password: '123456' },
  { nom: 'SIGARMOR',     email: 'sigarmorgroup@gmail.com',          password: '123456' },
  { nom: 'EIM',          email: 'ecoleimanagement@gmail.com',       password: '123456' },
  { nom: 'KIRKOS',       email: 'groupekirkos@gmail.com',           password: '123456' },
  { nom: 'KIRKOS_GUARD', email: 'groupekirkosguarduim@gmail.com',   password: '123456' },
  { nom: 'NEISS',        email: 'neissinvest@gmail.com',            password: '123456' },
  { nom: 'NORIA_BIANCA', email: 'yelgartili@groupekirkos.ma',       password: '123456' },
  { nom: 'CQ_SERVICE',   email: 'info.cqservice@gmail.com',         password: '123456' },
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
  log(`  Envoi de ${contracts.length} contrats vers Lambda (${societe})...`);
  try {
    const res = await fetch(LAMBDA_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contracts, societe })
    });
    const data = await res.json();
    if (res.ok && data.stats) {
      log(`  ✅ +${data.stats.created} créés, ↻${data.stats.updated} mis à jour, ✗${data.stats.errors} erreurs`);
      return data.stats;
    } else {
      log(`  ❌ Erreur Lambda: ${JSON.stringify(data)}`);
      return { created: 0, updated: 0, errors: contracts.length };
    }
  } catch(e) {
    log(`  ❌ Exception: ${e.message}`);
    return { created: 0, updated: 0, errors: contracts.length };
  }
}

async function processSociete(societe) {
  const societeDir = join(BASE_DIR, societe.nom);

  // Créer dossier société si inexistant
  if (!existsSync(societeDir)) mkdirSync(societeDir, { recursive: true });

  log(`\n━━━ ${societe.nom} (${societe.email}) ━━━`);

  // ── Scraping ──────────────────────────────────────────────
  log(`  Scraping ANAPEC...`);
  try {
    // Passer les credentials comme variables d'environnement
    const env = {
      ...process.env,
      ANAPEC_EMAIL:    societe.email,
      ANAPEC_PASSWORD: societe.password,
      ANAPEC_OUT_DIR:  societeDir
    };
    execSync(`node C:\\anapec\\scraper_anapec.mjs`, {
      stdio: 'inherit',
      timeout: 300000,
      env
    });
    log(`  ✅ Scraping terminé`);
  } catch(e) {
    log(`  ❌ Erreur scraping: ${e.message.substring(0, 100)}`);
    log(`  Tentative avec données existantes...`);
  }

  // ── Lire données ──────────────────────────────────────────
  const jsonPath = join(societeDir, 'contrats.json');
  if (!existsSync(jsonPath)) {
    log(`  ❌ contrats.json introuvable pour ${societe.nom}`);
    return { created: 0, updated: 0, errors: 0 };
  }

  const baseContracts = JSON.parse(readFileSync(jsonPath, 'utf8'));
  log(`  ${baseContracts.length} contrats trouvés`);

  if (baseContracts.length === 0) return { created: 0, updated: 0, errors: 0 };

  // ── Fusionner avec détails ────────────────────────────────
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

  // ── Envoyer à Lambda ──────────────────────────────────────
  return await sendToLambda(contracts, societe.nom);
}

async function main() {
  log('\n╔══════════════════════════════════════════════════╗');
  log('║  PIPELINE MULTI-SOCIÉTÉS ANAPEC → Monday.com    ║');
  log('╚══════════════════════════════════════════════════╝');

  let totalCreated = 0, totalUpdated = 0, totalErrors = 0;

  for (const societe of SOCIETES) {
    try {
      const stats = await processSociete(societe);
      totalCreated += stats.created || 0;
      totalUpdated += stats.updated || 0;
      totalErrors  += stats.errors  || 0;
    } catch(e) {
      log(`❌ ERREUR ${societe.nom}: ${e.message}`);
      totalErrors++;
    }
    // Pause entre sociétés
    await new Promise(r => setTimeout(r, 2000));
  }

  // ── Push vers GitHub ──────────────────────────────────────
  log('\n━━━ Push données vers GitHub ━━━');
  try {
    const date = new Date().toLocaleString('fr-FR');
    execSync(`cd C:\\anapec && git add -A && git commit -m "Données 8 sociétés - ${date}" && git push origin main`,
      { stdio: 'inherit', timeout: 60000 });
    log('✅ Données pushées vers GitHub');
  } catch(e) {
    log(`⚠️ Git: ${e.message.substring(0, 100)}`);
  }

  log('\n╔══════════════════════════════════════════════════╗');
  log(`║  FIN: +${totalCreated} créés, ↻${totalUpdated} mis à jour, ✗${totalErrors} erreurs  ║`);
  log('╚══════════════════════════════════════════════════╝\n');
}

main().catch(e => {
  log(`ERREUR CRITIQUE: ${e.message}`);
  process.exit(1);
});
