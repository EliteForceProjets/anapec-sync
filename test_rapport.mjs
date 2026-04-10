// ============================================================
// test_rapport.mjs - Test complet + rapport du pipeline
// ============================================================

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'fs';

const LAMBDA_URL = 'https://cel7jflv4gclxqw2ozvr2b46ku0dsczq.lambda-url.eu-north-1.on.aws/';
const OUT_DIR = 'C:\\anapec';

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

async function main() {
  console.log('');
  console.log('╔════════════════════════════════════════════════════╗');
  console.log('║     RAPPORT DE TEST - Pipeline ANAPEC → Monday     ║');
  console.log('╚════════════════════════════════════════════════════╝');
  console.log('');

  let rapport = [];
  let score = 0;
  let total = 0;

  // ── TEST 1 : contrats.json ───────────────────────────────
  console.log('━━━ TEST 1 : contrats.json ━━━━━━━━━━━━━━━━━━━━━━━━━');
  total++;
  try {
    const contracts = JSON.parse(readFileSync(`${OUT_DIR}\\contrats.json`, 'utf8'));
    console.log(`✅ Fichier trouvé : ${contracts.length} contrats`);
    console.log('');
    contracts.forEach((c, i) => {
      console.log(`  [${i+1}] ${c.ref} | ${c.etat} | ${c.date_sig} → ${c.date_fin} | CIN: ${c.cin}`);
    });
    console.log('');
    rapport.push(`TEST 1 ✅ : ${contracts.length} contrats dans contrats.json`);
    score++;
  } catch(e) {
    console.log('❌ ERREUR:', e.message);
    rapport.push('TEST 1 ❌ : contrats.json introuvable');
  }

  // ── TEST 2 : Fichiers détails HTML ───────────────────────
  console.log('━━━ TEST 2 : Fichiers détails ci_*.html ━━━━━━━━━━━━━');
  total++;
  try {
    const files = readdirSync(OUT_DIR).filter(f => f.startsWith('ci_') && f.endsWith('.html'));
    console.log(`✅ ${files.length} fichiers détails trouvés`);
    console.log('');

    let parsed = 0;
    files.slice(0, 3).forEach(file => {
      const html = readFileSync(`${OUT_DIR}\\${file}`, 'utf8');
      const detail = parseDetail(html);
      const fields = Object.entries(detail).filter(([k,v]) => v && v.length > 0);
      console.log(`  📄 ${file}`);
      fields.forEach(([k,v]) => console.log(`      ${k}: ${v}`));
      if (fields.length > 0) parsed++;
      console.log('');
    });

    rapport.push(`TEST 2 ✅ : ${files.length} fichiers HTML, ${parsed}/3 parsés avec succès`);
    score++;
  } catch(e) {
    console.log('❌ ERREUR:', e.message);
    rapport.push('TEST 2 ❌ : ' + e.message);
  }

  // ── TEST 3 : Lambda avec 1 contrat ───────────────────────
  console.log('━━━ TEST 3 : Test Lambda avec 1 contrat ━━━━━━━━━━━━━');
  total++;
  try {
    const contracts = JSON.parse(readFileSync(`${OUT_DIR}\\contrats.json`, 'utf8'));
    const testContract = contracts[0];
    console.log(`Envoi du contrat: ${testContract.ref}`);

    const res = await fetch(LAMBDA_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contracts: [testContract] })
    });

    const data = await res.json();
    console.log(`✅ Réponse Lambda: HTTP ${res.status}`);
    console.log(`   Message: ${data.message}`);
    console.log(`   Stats: +${data.stats?.created} créés, ↻${data.stats?.updated} mis à jour, ✗${data.stats?.errors} erreurs`);
    rapport.push(`TEST 3 ✅ : Lambda OK - ${data.message}`);
    score++;
  } catch(e) {
    console.log('❌ ERREUR:', e.message);
    rapport.push('TEST 3 ❌ : ' + e.message);
  }

  // ── TEST 4 : Pipeline complet ────────────────────────────
  console.log('');
  console.log('━━━ TEST 4 : Pipeline complet (tous contrats) ━━━━━━━');
  total++;
  try {
    const contracts = JSON.parse(readFileSync(`${OUT_DIR}\\contrats.json`, 'utf8'));
    const files = readdirSync(OUT_DIR).filter(f => f.startsWith('ci_') && f.endsWith('.html'));

    // Fusionner avec détails
    const detailMap = {};
    for (const file of files) {
      const html = readFileSync(`${OUT_DIR}\\${file}`, 'utf8');
      const detail = parseDetail(html);
      const id = file.replace('ci_','').replace('.html','');
      detailMap[id] = detail;
    }

    const merged = contracts.map(c => {
      const id = c.ref.match(/(\d{7,})/)?.[1];
      return { ...c, ...(detailMap[id] || {}) };
    });

    console.log(`Envoi de ${merged.length} contrats fusionnés vers Lambda...`);

    const res = await fetch(LAMBDA_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contracts: merged })
    });

    const data = await res.json();
    console.log(`✅ Réponse: HTTP ${res.status}`);
    console.log(`   +${data.stats?.created} créés`);
    console.log(`   ↻${data.stats?.updated} mis à jour`);
    console.log(`   ✗${data.stats?.errors} erreurs`);
    rapport.push(`TEST 4 ✅ : Pipeline complet - ${data.stats?.updated} mis à jour, ${data.stats?.created} créés`);
    score++;
  } catch(e) {
    console.log('❌ ERREUR:', e.message);
    rapport.push('TEST 4 ❌ : ' + e.message);
  }

  // ── RÉSUMÉ FINAL ─────────────────────────────────────────
  console.log('');
  console.log('╔════════════════════════════════════════════════════╗');
  console.log(`║  RÉSUMÉ : ${score}/${total} tests réussis                          ║`);
  console.log('╚════════════════════════════════════════════════════╝');
  rapport.forEach(r => console.log('  ' + r));
  console.log('');

  // Sauvegarder rapport
  const rapportText = [
    '=== RAPPORT PIPELINE ANAPEC → MONDAY ===',
    `Date: ${new Date().toLocaleString('fr-FR')}`,
    `Score: ${score}/${total}`,
    '',
    ...rapport
  ].join('\n');

  writeFileSync(`${OUT_DIR}\\rapport_test.txt`, rapportText, 'utf8');
  console.log(`📄 Rapport sauvegardé: ${OUT_DIR}\\rapport_test.txt`);
}

main().catch(e => console.error('ERREUR CRITIQUE:', e.message));
