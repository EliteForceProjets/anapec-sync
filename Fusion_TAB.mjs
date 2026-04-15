// ============================================================
// Fusion_TAB.mjs — Fusion des 8 tableaux Monday → ANAPEC_GLOBAL
// Board cible : 5094534887
// Usage      : node C:\anapec\Fusion_TAB.mjs
// v8 - FIX: détection arabe par ratio Unicode (comme run_all v8)
// ============================================================

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';

const LAMBDA_URL    = 'https://cel7jflv4gclxqw2ozvr2b46ku0dsczq.lambda-url.eu-north-1.on.aws/';
const BASE_DIR      = 'C:\\anapec';
const LOG_FILE      = join(BASE_DIR, 'fusion_log.txt');
const SOCIETE_CIBLE = 'ANAPEC_GLOBAL';

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

function log(msg) {
  const line = `[${new Date().toLocaleString('fr-FR')}] ${msg}`;
  console.log(line);
  try {
    const existing = existsSync(LOG_FILE) ? readFileSync(LOG_FILE, 'utf8') : '';
    writeFileSync(LOG_FILE, existing + line + '\n');
  } catch(e) {}
}

// ─────────────────────────────────────────────────────────────
// extractPrintable — extrait div.printable / div.arriereprintable
// Supprime les <script> après extraction (évite pollution isFrench)
// ─────────────────────────────────────────────────────────────
function extractPrintable(html) {
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
// isArabicContent — FIX v8: détection fiable arabe vs français
//
// ANCIEN BUG: "Contrat d'Insertion" apparaît dans TOUS les fichiers
// arabes (bouton d'impression) → isFrench=true → rien extrait.
//
// SOLUTION: compter les chars Unicode arabes U+0600–U+06FF
// Si > 5% du texte non-espace = arabe → document arabe
// ─────────────────────────────────────────────────────────────
function isArabicContent(text) {
  const arabicChars = (text.match(/[\u0600-\u06FF]/g) || []).length;
  const totalNonSpace = text.replace(/\s/g, '').length;
  if (totalNonSpace === 0) return false;
  if (arabicChars / totalNonSpace > 0.05) return true;
  return text.includes('لمدة') || text.includes('مبلغها') ||
         text.includes('تعيين') || text.includes('المتدرب') ||
         text.includes('رب العمل') || text.includes('الوكالة');
}

// ─────────────────────────────────────────────────────────────
// parseDetail v8 — bilingue arabe + français
// ─────────────────────────────────────────────────────────────
function parseDetail(html) {
  const printable = extractPrintable(html);
  const text = htmlToText(printable);

  // FIX v8: détection par ratio Unicode, pas par mots-clés fragiles
  const isArabic = isArabicContent(text);
  const isFrench = !isArabic && (
    text.includes('EMPLOYEUR') || text.includes('Employeur') ||
    text.includes('raison sociale') || text.includes('Nom ou raison') ||
    text.includes('STAGIAIRE') || text.includes('Statut juridique') ||
    text.includes('fixé à') || text.includes('CONVENTION')
  );

  const find = (...patterns) => {
    for (const p of patterns) {
      const m = text.match(p);
      if (m?.[1]?.trim()) return m[1].trim();
    }
    return '';
  };

  if (isFrench) {
    // ════════════════════════════════════════════════════════
    // FRANÇAIS
    // ════════════════════════════════════════════════════════
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
    // ════════════════════════════════════════════════════════
    // ARABE — v8: détection par ratio Unicode fiable
    // ════════════════════════════════════════════════════════
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
        const m_par = text.match(/لمدة\s+\(\d+\)\s+(\d+)\s+شهر/);
        if (m_par) return m_par[1];
        const m_note = text.match(/لمدة\s+\d\s+(\d{2})\s+شهر/);
        if (m_note) return m_note[1];
        const m_simple = text.match(/لمدة\s+(\d+)\s+شهر/);
        if (m_simple) return m_simple[1];
        const m_conf = text.match(/\((\d+)\s+شهر[اً]?\s+غير\s+قابلة/);
        if (m_conf) return m_conf[1];
        const m_mda = find(/المدة[^:\n]*:\s*(\d+)/);
        if (m_mda) return m_mda;
        return '';
      })(),
      salaire: (() => {
        const m1 = text.match(/مبلغها\s+في\s+[\s]*([\d.,]+)\s*درهم/);
        if (m1) return m1[1].replace(',','.');
        const m2 = text.match(/في\s+([\d.,]{3,9})\s*درهم/);
        if (m2) { const v=parseFloat(m2[1].replace(',','.')); if(v>=1000&&v<=20000) return m2[1].replace(',','.'); }
        const m3 = text.match(/الأجر[^:\n]*:\s*([\d\s.,]+)/);
        if (m3) { const v=m3[1].replace(/\s/g,'').replace(',','.'); if(parseFloat(v)>=500) return v; }
        const m4 = text.match(/بحد أعلى\s*([\d.,]+)\s*درهم/);
        if (m4) return m4[1].replace(',','.');
        return '';
      })(),
    };
  }
}

// ─────────────────────────────────────────────────────────────
// sendToLambda
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
// chargerContrats — triple mapping: detail_id > ref > CIN
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

  const detailIdMap = {};
  const refTextMap  = {};
  const cinMap      = {};

  if (existsSync(societeDir)) {
    const files = readdirSync(societeDir).filter(f => f.startsWith('ci_') && f.endsWith('.html'));
    for (const file of files) {
      const fileId = file.replace('ci_', '').replace('.html', '');
      try {
        const html      = readFileSync(join(societeDir, file), 'utf8');
        const detail    = parseDetail(html);
        const cleanText = html.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ');

        // Méthode 1: ID fichier → detail
        detailIdMap[fileId] = detail;

        // Méthode 2: refs dans texte HTML → detail
        const refs = [...cleanText.matchAll(/\b([A-Z]{0,3}\d{8,}\/\d+)\b/g)].map(m => m[1]);
        for (let ref of [...new Set(refs)]) {
          if (ref.match(/^I\d/)) ref = 'A' + ref;
          refTextMap[ref] = detail;
          refTextMap[ref.replace(/^A/, '')] = detail;
          if (ref.startsWith('NO')) refTextMap[ref.slice(2)] = detail;
          if (ref.startsWith('NI')) refTextMap[ref.slice(2)] = detail;
          if (ref.startsWith('AL')) refTextMap[ref.slice(2)] = detail;
        }

        // Méthode 3: CIN → detail
        if (detail.cin) cinMap[detail.cin] = detail;
        const cins = [...cleanText.matchAll(/\b([A-Z]{1,2}\d{5,8})\b/g)].map(m => m[1]);
        for (const cin of [...new Set(cins)]) cinMap[cin] = detail;
      } catch(e) {}
    }
  }

  const contracts = baseContracts.map(c => {
    // Nettoyer dates "---"
    const date_sig = (c.date_sig === '---' || c.date_sig === '--') ? '' : (c.date_sig||'');
    const date_fin = (c.date_fin === '---' || c.date_fin === '--') ? '' : (c.date_fin||'');

    // Triple mapping
    const detailId = c.detail_id || '';
    const detail =
      (detailId && detailIdMap[detailId]) ||
      refTextMap[c.ref] ||
      refTextMap[(c.ref||'').replace(/^A/,'')] ||
      (c.cin && cinMap[c.cin]) ||
      null;

    return {
      ref:       c.ref      || '',
      date_sig,
      date_fin,
      etat:      c.etat     || '',
      type:      c.type     || '',
      cin:       c.cin      || '',
      email_soc: nomSociete,
      ...(detail || {})
    };
  });

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
  log('║   FUSION_TAB v8 — Regroupement 8 sociétés → ANAPEC_GLOBAL ║');
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
