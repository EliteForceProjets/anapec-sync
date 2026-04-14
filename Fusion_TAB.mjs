// ============================================================
// Fusion_TAB.mjs — Fusion des 8 tableaux Monday → ANAPEC_GLOBAL
// Board cible : 5094534887
// Usage      : node C:\anapec\Fusion_TAB.mjs
// ============================================================

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';

const LAMBDA_URL   = 'https://cel7jflv4gclxqw2ozvr2b46ku0dsczq.lambda-url.eu-north-1.on.aws/';
const BASE_DIR     = 'C:\\anapec';
const LOG_FILE     = join(BASE_DIR, 'fusion_log.txt');
const SOCIETE_CIBLE = 'ANAPEC_GLOBAL';   // board ID 5094534887 dans Lambda

// Les 8 sociétés sources — même ordre que run_all.mjs
const SOCIETES = [
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
// Logger
// ─────────────────────────────────────────────────────────────
function log(msg) {
  const line = `[${new Date().toLocaleString('fr-FR')}] ${msg}`;
  console.log(line);
  try {
    const existing = existsSync(LOG_FILE) ? readFileSync(LOG_FILE, 'utf8') : '';
    writeFileSync(LOG_FILE, existing + line + '\n');
  } catch(e) {}
}

// ─────────────────────────────────────────────────────────────
// htmlToText — convertit HTML en texte propre
// ─────────────────────────────────────────────────────────────
function htmlToText(html) {
  return html
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:p|td|th|div|tr|li)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n');
}

// ─────────────────────────────────────────────────────────────
// extractPrintable — extrait le bloc .printable du HTML
// ─────────────────────────────────────────────────────────────
function extractPrintable(html) {
  // FIX CRITIQUE : supprimer les scripts qui contiennent "Convention", "EMPLOYEUR"
  // → sinon isFrench=true sur contrats arabes → colonnes vides
  const tagMatch = html.match(/<div[^>]*class=["'][^"']*printable[^"']*["'][^>]*>/i);
  if (tagMatch) {
    const startIdx = html.indexOf(tagMatch[0]);
    if (startIdx >= 0) {
      const after = html.slice(startIdx + tagMatch[0].length);
      const endIdx = after.search(/<\/body>/i);
      const raw = endIdx > 0 ? after.slice(0, endIdx) : after;
      return raw.replace(/<script[\s\S]*?<\/script>/gi, '');
    }
  }
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  const body = bodyMatch ? bodyMatch[1] : html;
  return body.replace(/<script[\s\S]*?<\/script>/gi, '');
}

// ─────────────────────────────────────────────────────────────
// parseDetail — bilingue arabe + français (repris de run_all.mjs)
// ─────────────────────────────────────────────────────────────
function parseDetail(html) {
  const printable = extractPrintable(html);
  const text = htmlToText(printable);

  const isFrench = text.includes('EMPLOYEUR') || text.includes('Employeur') ||
                   text.includes('STAGIAIRE')  || text.includes('Stagiaire')  ||
                   text.includes('CONVENTION') || text.includes("Contrat d'Insertion") ||
                   text.includes('Agence Nationale') || text.includes('raison sociale');

  const find = (...patterns) => {
    for (const p of patterns) {
      const m = text.match(p);
      if (m?.[1]?.trim()) return m[1].trim();
    }
    return '';
  };

  if (isFrench) {
    return {
      agence:     find(/Agence\s*:\s*([^\n<]{3,60})/i),
      nom_entrep: find(/Nom\s+ou\s+raison\s+sociale\s*[:\u00a0]+\s*([^\n<]{2,80})/i),
      secteur:    find(/Secteur\s+d.activit[eé]\s*:\s*([^\n<]{3,80})/i),
      adresse:    find(/Adresse\s*:\s*([^\n<]{5,150})/i),
      telephone: (() => {
        const m = text.match(/T[eé]l[^:\n]*:\s*([\d\/\s+.]{7,30})/i);
        if (m) { const n = m[1].match(/(0\d{9})/g); return n ? n[0] : m[1].trim(); }
        return text.match(/(0[567]\d{8})/)?.[1] || '';
      })(),
      rc:        find(/registre\s+du\s+[Cc]ommerce\s*:\s*(\d+)/i),
      cnss_empl: find(/affiliation\s+.+C\.N\.S\.S[^:]*:\s*(\d+)/i),
      forme_jur: find(/Statut\s+juridique\s*:\s*([^\n<]{3,60})/i),
      nom_agent: (() => {
        const m1 = text.match(/Nom\s+et\s+pr[eé]nom\s*[:\u00a0]+\s*([A-Z][A-Z\s]{1,40}?)\s{2,}([A-Z][^\n<]{1,40})/);
        if (m1) return m1[1].trim();
        const m2 = text.match(/Nom\s+et\s+pr[eé]nom\s*[:\u00a0]+\s*([A-Z][^\n<]{3,60})/i);
        if (m2) { const p = m2[1].trim().split(/\s+/); return p.length > 1 ? p.slice(0,-1).join(' ') : p[0]; }
        return '';
      })(),
      prenom: (() => {
        const m1 = text.match(/Nom\s+et\s+pr[eé]nom\s*[:\u00a0]+\s*([A-Z][A-Z\s]{1,40}?)\s{2,}([A-Z][^\n<]{1,40})/);
        if (m1) return m1[2].trim();
        const m2 = text.match(/Nom\s+et\s+pr[eé]nom\s*[:\u00a0]+\s*([A-Z][^\n<]{3,60})/i);
        if (m2) { const p = m2[1].trim().split(/\s+/); return p.length > 1 ? p[p.length-1] : ''; }
        return '';
      })(),
      nationalite: find(/Nationalit[eé]\s*:\s*([^\n<]{3,30})/i),
      cin: (() => {
        const m = text.match(/CIN[^:]*:\s*([A-Z]{1,2}\d{5,8})/i) || text.match(/\b([A-Z]{1,2}\d{5,8})\b/);
        return m?.[1] || '';
      })(),
      cnss_agent: find(/immatriculation\s+.+C\.N\.S\.S[^:]*:\s*(\d{6,12})/i),
      niveau:     find(/Niveau\s+d.instruction[^:]*:\s*([^\n<]{3,80})/i),
      poste: (() => {
        const m1 = text.match(/affecter\s+au\s+poste\s+de\s+(?:travail\s+)?([^\n.<]{3,80})/i);
        if (m1) return m1[1].trim().replace(/\s*\.$/, '');
        const m2 = text.match(/occuper\s+le\s+poste\s+de\s+(?:travail\s+)?([^\n.<]{3,80})/i);
        if (m2) return m2[1].trim().replace(/\s*\.$/, '');
        const m3 = text.match(/[Pp]oste\s+(?:de\s+travail\s*)?:\s*([^\n<.]{3,60})/);
        if (m3) return m3[1].trim();
        return '';
      })(),
      duree: (() => {
        const m1 = text.match(/dur[eé]e\s+de\s+\(\d+\)\s+(\d+)\s+mois/i);
        if (m1) return m1[1];
        const m2 = text.match(/dur[eé]e\s+de\s+(\d+)\s+mois/i);
        if (m2) return m2[1];
        const m3 = text.match(/pendant\s+(\d+)\s+mois/i);
        if (m3) return m3[1];
        const m4 = text.match(/[Dd]ur[eé]e\s*[:\-]\s*(\d+)/);
        if (m4) return m4[1];
        return '';
      })(),
      salaire: (() => {
        const m1 = text.match(/fix[eé]\s+[àa]\s+([\d\s.,]+?)\s*DH/i);
        if (m1) { const v=m1[1].replace(/\s/g,'').replace(',','.'); if(parseFloat(v)>=1000&&parseFloat(v)<=20000) return v; }
        const m2 = text.match(/([\d]{3,5}(?:[.,]\d{1,2})?)\s*DH\s*\(/i);
        if (m2) { const v=m2[1].replace(',','.'); if(parseFloat(v)>=1000) return v; }
        const m3 = text.match(/est\s+de\s+([\d\s.,]+?)\s*DH/i);
        if (m3) { const v=m3[1].replace(/\s/g,'').replace(',','.'); if(parseFloat(v)>=1000) return v; }
        return '';
      })(),
    };
  } else {
    // ARABE
    return {
      agence:     find(/الوكالة\s*:\s*([^\n|]{3,60})/),
      nom_entrep: find(/الاسم [أا]و العنوان التجاري\s*:\s*([^\n]{3,80})/)
                  || find(/الاسم [أا]و المقاول[^:\n]*:\s*([^\n]{3,80})/),
      secteur:    find(/قطاع النشاط[^:\n]*:\s*([^\n]{3,80})/),
      adresse:    find(/العنوان\s*:\s*([^\n]{5,150})/),
      telephone:  find(/(0[567]\d{8})/),
      rc:         find(/رقم القيد في السجل التجاري[^:\n]*:\s*(\d+)/),
      cnss_empl:  find(/رقم الانخراط[^:\n]*:\s*(\d+)/),
      forme_jur:  find(/النظام القانوني[^:\n]*:\s*([^\n]{3,60})/),
      nom_agent: (() => {
        const s1 = find(/الاسم العائلي\s*(?:والشخصي)?\s*[:\u00a0]+\s*([^\n]{2,40})/);
        if (s1) return s1.trim().split(/\s+/)[0] || s1;
        const s2 = find(/الاسم المالي والشخصي[^:\n]*:\s*([^\n]{2,60})/);
        if (s2) return s2.trim().split(/\s+/)[0] || '';
        return '';
      })(),
      prenom: (() => {
        const s1 = find(/الاسم الشخصي[^:\n]*:\s*([^\n]{2,40})/);
        if (s1) return s1;
        const m = text.match(/الاسم العائلي\s*(?:والشخصي)?\s*[:\u00a0]+\s*([^\n]{2,40})\n\s*([^\n]{2,40})/);
        if (m) return m[2].trim();
        const s2 = find(/الاسم المالي والشخصي[^:\n]*:\s*([^\n]{2,60})/);
        if (s2) { const p=s2.trim().split(/\s+/); return p.length>1?p.slice(1).join(' '):''; }
        return '';
      })(),
      nationalite: find(/الجنسية[^:\n]*:\s*([^\n]{3,30})/),
      cin:         text.match(/\b([A-Z]{1,2}\d{5,8})\b/)?.[1] || '',
      cnss_agent:  find(/رقم التسجيل بالصندوق[^:\n]*:\s*(\d{6,12})/),
      niveau:      find(/المستوى التعليمي[^:\n]*:\s*([^\n]{3,60})/),
      poste: (() => {
        const m1 = text.match(/تعيين[^\n:]*:\s*(?:الشغل\s*)?([A-Za-z][A-Za-zÀ-ÿ\s'''\u2019\-]{3,60})/i);
        if (m1) return m1[1].trim().replace(/\s*[.،]\s*$/, '').toUpperCase();
        const m2 = text.match(/الشغل\s*([A-Za-z][A-Za-zÀ-ÿ\s'''\u2019\-]{3,60})/i);
        if (m2) return m2[1].trim().replace(/\s*[.،]\s*$/, '').toUpperCase();
        const m3 = text.match(/المهنة[^:\n]*:\s*([^\n]{3,60})/);
        if (m3) return m3[1].trim();
        return '';
      })(),
      duree: (() => {
        const m1 = text.match(/لمدة\s+(\d)\s+(\d+)\s+شهر/);
        if (m1) return m1[2];
        const m2 = text.match(/لمدة\s+(\d+)\s+شهر/);
        if (m2) return m2[1];
        const m3 = find(/المدة[^:\n]*:\s*(\d+)/);
        if (m3) return m3;
        const m4 = text.match(/\((\d+)\s+شهر[اً]?\s+غير\s+قابلة/);
        if (m4) return m4[1];
        return '';
      })(),
      salaire: (() => {
        const m1 = text.match(/مبلغها\s+في\s+([\d.,]+)\s*درهم/);
        if (m1) return m1[1].replace(',','.');
        const m2 = text.match(/في\s+([\d.,]{3,9})\s*درهم/);
        if (m2) { const v=parseFloat(m2[1].replace(',','.')); if(v>=1000&&v<=20000) return m2[1].replace(',','.'); }
        const m3 = text.match(/الأجر[^:\n]*:\s*([\d\s.,]+)/);
        if (m3) { const v=m3[1].replace(/\s/g,'').replace(',','.'); if(parseFloat(v)>=500) return v; }
        return '';
      })(),
    };
  }
}

// ─────────────────────────────────────────────────────────────
// Envoyer un lot de contrats vers Lambda → ANAPEC_GLOBAL
// ─────────────────────────────────────────────────────────────
async function sendToLambda(contracts, label) {
  log(`  → Envoi de ${contracts.length} contrats (${label}) vers ANAPEC_GLOBAL...`);
  try {
    const res = await fetch(LAMBDA_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contracts, societe: SOCIETE_CIBLE })
    });
    const data = await res.json();
    if (res.ok && data.stats) {
      log(`  ✅ ${label}: +${data.stats.created} créés, ↻${data.stats.updated} mis à jour, ✗${data.stats.errors} erreurs`);
      return data.stats;
    } else {
      log(`  ❌ Erreur Lambda (${label}): ${JSON.stringify(data)}`);
      return { created: 0, updated: 0, errors: contracts.length };
    }
  } catch(e) {
    log(`  ❌ Exception (${label}): ${e.message}`);
    return { created: 0, updated: 0, errors: contracts.length };
  }
}

// ─────────────────────────────────────────────────────────────
// Charger et enrichir les contrats d'une société
// ─────────────────────────────────────────────────────────────
function chargerContrats(nomSociete) {
  const societeDir = join(BASE_DIR, nomSociete);
  const jsonPath   = join(societeDir, 'contrats.json');

  if (!existsSync(jsonPath)) {
    log(`  ⚠️  ${nomSociete}: contrats.json introuvable → ignoré`);
    return [];
  }

  const baseContracts = JSON.parse(readFileSync(jsonPath, 'utf8'));
  if (baseContracts.length === 0) {
    log(`  ⚠️  ${nomSociete}: 0 contrats`);
    return [];
  }

  // Construire les maps depuis les fichiers HTML
  const detailMap = {};
  const cinMap    = {};

  if (existsSync(societeDir)) {
    const files = readdirSync(societeDir).filter(f => f.startsWith('ci_') && f.endsWith('.html'));
    for (const file of files) {
      try {
        const html      = readFileSync(join(societeDir, file), 'utf8');
        const detail    = parseDetail(html);
        const cleanText = html.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ');

        // Map par référence contrat
        const refs = [...cleanText.matchAll(/\b([A-Z]{0,3}\d{8,}\/\d+)\b/g)].map(m => m[1]);
        for (let ref of [...new Set(refs)]) {
          if (ref.match(/^I\d/)) ref = 'A' + ref;
          detailMap[ref] = detail;
          detailMap[ref.replace(/^A/, '')] = detail;
          if (ref.startsWith('NO')) detailMap[ref.slice(2)] = detail;
          if (ref.startsWith('NI')) detailMap[ref.slice(2)] = detail;
          if (ref.startsWith('AL')) detailMap[ref.slice(2)] = detail;
        }
        // Map par CIN
        const cins = [...cleanText.matchAll(/\b([A-Z]{1,2}\d{5,8})\b/g)].map(m => m[1]);
        for (const cin of [...new Set(cins)]) cinMap[cin] = detail;
      } catch(e) {}
    }
  }

  // Fusionner les données de base avec les détails HTML
  const contracts = baseContracts.map(c => ({
    ref:      c.ref      || '',
    date_sig: c.date_sig || '',
    date_fin: c.date_fin || '',
    etat:     c.etat     || '',
    type:     c.type     || '',
    cin:      c.cin      || '',
    // Champ supplémentaire : société source (utile dans ANAPEC_GLOBAL)
    email_soc: nomSociete,
    ...(detailMap[c.ref] || cinMap[c.cin] || {})
  }));

  // Stats rapides
  const ok  = contracts.filter(c => c.poste && c.salaire && c.duree).length;
  const nok = contracts.length - ok;
  log(`  📋 ${nomSociete}: ${contracts.length} contrats (${ok} complets, ${nok} incomplets)`);

  return contracts;
}

// ─────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────
async function main() {
  log('\n╔══════════════════════════════════════════════════════╗');
  log('║   FUSION_TAB — Regroupement 8 sociétés → ANAPEC_GLOBAL ║');
  log('╚══════════════════════════════════════════════════════╝\n');

  let totalContracts = 0;
  let totalCreated   = 0;
  let totalUpdated   = 0;
  let totalErrors    = 0;

  for (const nom of SOCIETES) {
    log(`\n━━━ ${nom} ━━━`);
    const contracts = chargerContrats(nom);
    if (contracts.length === 0) continue;

    totalContracts += contracts.length;

    const stats = await sendToLambda(contracts, nom);
    totalCreated += stats.created || 0;
    totalUpdated += stats.updated || 0;
    totalErrors  += stats.errors  || 0;

    // Pause entre sociétés pour ne pas saturer Lambda
    await new Promise(r => setTimeout(r, 1500));
  }

  log('\n╔══════════════════════════════════════════════════════╗');
  log(`║  TOTAL TRAITÉ  : ${totalContracts} contrats`);
  log(`║  +${totalCreated} créés  ↻${totalUpdated} mis à jour  ✗${totalErrors} erreurs`);
  log('╚══════════════════════════════════════════════════════╝\n');
}

main().catch(e => {
  log(`ERREUR CRITIQUE: ${e.message}`);
  process.exit(1);
});
