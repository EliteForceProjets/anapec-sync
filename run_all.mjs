// ============================================================
// run_all.mjs - Pipeline complet pour les 8 sociétés
// v7 - FIX DÉFINITIF:
//   1. Mapping direct par detail_id (ci_XXXXX.html) → plus de
//      recherche de ref dans le texte HTML (source du bug)
//   2. Regex durée corrigée pour format "(1) 24 شهرا"
//   3. Fallback robuste par CIN si detail_id absent
// ============================================================

import { execSync } from 'child_process';
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync, unlinkSync } from 'fs';
import { join } from 'path';

const LAMBDA_URL = 'https://cel7jflv4gclxqw2ozvr2b46ku0dsczq.lambda-url.eu-north-1.on.aws/';
const BASE_DIR   = 'C:\\anapec';
const LOG_FILE   = join(BASE_DIR, 'sync_log.txt');

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

// ─────────────────────────────────────────────────────────────
// extractPrintable — extrait la section du contrat uniquement
// ─────────────────────────────────────────────────────────────
function extractPrintable(html) {
  // Cherche div.printable OU div.arriereprintable
  const tagMatch = html.match(/<div[^>]*class=["'][^"']*printable[^"']*["'][^>]*>/i);
  if (tagMatch) {
    const startIdx = html.indexOf(tagMatch[0]);
    if (startIdx >= 0) {
      const after = html.slice(startIdx + tagMatch[0].length);
      const endIdx = after.search(/<\/body>/i);
      return endIdx > 0 ? after.slice(0, endIdx) : after;
    }
  }
  // Fallback : body sans scripts
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
// parseDetail v7 — extraction robuste arabe + français
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
    // ════════════════════════════════════════════════════════
    // ARABE - v7 FIX: regex durée corrigée pour format "(1) 24 شهرا"
    // ════════════════════════════════════════════════════════
    return {
      agence:     find(/الوكالة\s*:\s*([^\n|]{3,60})/),
      nom_entrep: find(/الاسم [أا]و العنوان التجاري\s*:\s*([^\n]{3,80})/)
                  || find(/الاسم [أا]و المقاول[^:\n]*:\s*([^\n]{3,80})/)
                  || (text.match(/GRUPO[^\n,]*/)?.[0] || ''),
      secteur:    find(/قطاع النشاط[^:\n]*:\s*([^\n]{3,80})/)
                  || (text.match(/Services fournis[^\n]*/)?.[0] || ''),
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

      // POSTE arabe
      poste: (() => {
        const m1 = text.match(/تعيين[^\n:]*:\s*(?:الشغل\s*)?([A-Za-z][A-Za-z\s''\u2019\-]{3,60})/i);
        if (m1) return m1[1].trim().replace(/\s*[.،]\s*$/, '').toUpperCase();
        const m2 = text.match(/الشغل\s+([A-Za-z][A-Za-z\s''\u2019\-]{3,60})/i);
        if (m2) return m2[1].trim().replace(/\s*[.،]\s*$/, '').toUpperCase();
        const m3 = text.match(/المهنة[^:\n]*:\s*([^\n]{3,60})/);
        if (m3) return m3[1].trim();
        return '';
      })(),

      // DURÉE arabe v7 - FIX: gère "(1) 24 شهرا" ET "1 24 شهرا" ET "24 شهرا"
      duree: (() => {
        // Format avec parenthèses: "لمدة (1) 24 شهرا" (NOTE le chiffre entre parenthèses)
        const m_par = text.match(/لمدة\s+\(\d+\)\s+(\d+)\s+شهر/);
        if (m_par) return m_par[1];
        // Format sans parenthèses avec note: "لمدة 1 24 شهرا"
        const m_note = text.match(/لمدة\s+\d\s+(\d{2})\s+شهر/);
        if (m_note) return m_note[1];
        // Format simple: "لمدة 24 شهرا"
        const m_simple = text.match(/لمدة\s+(\d+)\s+شهر/);
        if (m_simple) return m_simple[1];
        // Parenthèse de confirmation: "(24 شهرا غير قابلة للتجديد)"
        const m_conf = text.match(/\((\d+)\s+شهر[اً]?\s+غير\s+قابلة/);
        if (m_conf) return m_conf[1];
        // المدة : X
        const m_mda = find(/المدة[^:\n]*:\s*(\d+)/);
        if (m_mda) return m_mda;
        return '';
      })(),

      // SALAIRE arabe v7 - robuste
      salaire: (() => {
        // "مبلغها في [espaces multiples] XXXX درهم"
        const m1 = text.match(/مبلغها\s+في\s+[\s]*([\d.,]+)\s*درهم/);
        if (m1) return m1[1].replace(',','.');
        // "في XXXX درهم" générique
        const m2 = text.match(/في\s+([\d.,]{3,9})\s*درهم/);
        if (m2) { const v=parseFloat(m2[1].replace(',','.')); if(v>=1000&&v<=20000) return m2[1].replace(',','.'); }
        // الأجر
        const m3 = text.match(/الأجر[^:\n]*:\s*([\d\s.,]+)/);
        if (m3) { const v=m3[1].replace(/\s/g,'').replace(',','.'); if(parseFloat(v)>=500) return v; }
        // بحد أعلى
        const m4 = text.match(/بحد أعلى\s*([\d.,]+)\s*درهم/);
        if (m4) return m4[1].replace(',','.');
        return '';
      })(),
    };
  }
}

function isFrenchHtml(html) {
  return html.includes('EMPLOYEUR') || html.includes('Employeur') ||
         html.includes('STAGIAIRE') || html.includes('raison sociale') ||
         html.includes('CONVENTION');
}

async function sendToLambda(contracts, societe) {
  log(`  Envoi de ${contracts.length} contrats vers Lambda (${societe})...`);
  try {
    const res = await fetch(LAMBDA_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contracts, societe })
    });
    const data = await res.json();
    if (res.ok && data.stats) {
      log(`  ✅ +${data.stats.created} créés, ↻${data.stats.updated} mis à jour, ✗${data.stats.errors} erreurs`);
      return data.stats;
    } else {
      log(`  ❌ Erreur Lambda: ${JSON.stringify(data)}`);
      return { created:0, updated:0, errors:contracts.length };
    }
  } catch(e) {
    log(`  ❌ Exception: ${e.message}`);
    return { created:0, updated:0, errors:contracts.length };
  }
}

async function processSociete(societe) {
  const societeDir = join(BASE_DIR, societe.nom);
  if (!existsSync(societeDir)) mkdirSync(societeDir, { recursive: true });
  log(`\n━━━ ${societe.nom} (${societe.email}) ━━━`);

  log(`  Scraping ANAPEC...`);
  try {
    const env = { ...process.env, ANAPEC_EMAIL: societe.email, ANAPEC_PASSWORD: societe.password, ANAPEC_OUT_DIR: societeDir };
    execSync(`node C:\\anapec\\scraper_anapec.mjs`, { stdio:'inherit', timeout:600000, env });
    log(`  ✅ Scraping terminé`);
  } catch(e) {
    log(`  ❌ Erreur scraping: ${e.message.substring(0,100)}`);
    log(`  Tentative avec données existantes...`);
  }

  const jsonPath = join(societeDir, 'contrats.json');
  if (!existsSync(jsonPath)) { log(`  ❌ contrats.json introuvable`); return {created:0,updated:0,errors:0}; }

  const baseContracts = JSON.parse(readFileSync(jsonPath, 'utf8'));
  log(`  ${baseContracts.length} contrats trouvés`);
  if (baseContracts.length === 0) return {created:0,updated:0,errors:0};

  // ─────────────────────────────────────────────────────────────
  // FIX v7: Mapping DIRECT par detail_id
  // ci_1566868.html → contrat avec detail_id="1566868"
  // Beaucoup plus fiable que de chercher la ref dans le texte HTML
  // ─────────────────────────────────────────────────────────────
  const detailIdMap = {}; // detail_id → parseDetail result
  const cinMap = {};      // CIN → parseDetail result (fallback)

  const files = readdirSync(societeDir).filter(f => f.startsWith('ci_') && f.endsWith('.html'));

  for (const file of files) {
    // Extraire le detail_id depuis le nom de fichier (ci_1566868.html → "1566868")
    const fileId = file.replace('ci_', '').replace('.html', '');
    try {
      const html = readFileSync(join(societeDir, file), 'utf8');
      const detail = parseDetail(html);
      detailIdMap[fileId] = detail;

      // Fallback CIN
      if (detail.cin) cinMap[detail.cin] = detail;

      // Fallback aussi par refs trouvées dans le texte (compatibilité ancienne)
      const cleanText = html.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ');
      const refs = [...cleanText.matchAll(/\b([A-Z]{0,3}\d{8,}\/\d+)\b/g)].map(m=>m[1]);
      for (let ref of [...new Set(refs)]) {
        if (ref.match(/^I\d/)) ref = 'A' + ref;
        detailIdMap['ref_' + ref] = detail;
        detailIdMap['ref_' + ref.replace(/^A/,'')] = detail;
        if (ref.startsWith('NO')) detailIdMap['ref_' + ref.slice(2)] = detail;
        if (ref.startsWith('NI')) detailIdMap['ref_' + ref.slice(2)] = detail;
        if (ref.startsWith('AL')) detailIdMap['ref_' + ref.slice(2)] = detail;
      }
    } catch(e) {}
  }

  const contracts = baseContracts.map(c => {
    // Méthode 1: mapping direct par detail_id (le plus fiable)
    const detailId = c.detail_id || '';
    let detail = detailId ? detailIdMap[detailId] : null;

    // Méthode 2: fallback par ref dans le texte HTML
    if (!detail || (!detail.poste && !detail.salaire)) {
      detail = detailIdMap['ref_' + c.ref]
            || detailIdMap['ref_' + c.ref.replace(/^A/, '')]
            || null;
    }

    // Méthode 3: fallback par CIN
    if ((!detail || (!detail.poste && !detail.salaire)) && c.cin) {
      detail = cinMap[c.cin] || null;
    }

    const merged = {
      ref: c.ref||'', date_sig: c.date_sig||'', date_fin: c.date_fin||'',
      etat: c.etat||'', type: c.type||'', cin: c.cin||'',
      ...(detail || {})
    };

    const missing = [];
    if (!merged.poste)   missing.push('poste');
    if (!merged.salaire) missing.push('salaire');
    if (!merged.duree)   missing.push('durée');
    if (missing.length > 0) {
      log(`  ⚠️  ${merged.ref}: [${missing.join(',')}] sal="${merged.salaire||'?'}" dur="${merged.duree||'?'}" poste="${merged.poste||'?'}"`);
    } else {
      log(`  ✅ ${merged.ref}: sal="${merged.salaire}" dur="${merged.duree}" poste="${merged.poste}"`);
    }
    return merged;
  });

  return await sendToLambda(contracts, societe.nom);
}

async function main() {
  log('\n╔══════════════════════════════════════════════════╗');
  log('║  PIPELINE MULTI-SOCIÉTÉS ANAPEC → Monday.com    ║');
  log('║  VERSION: Bilingue Arabe + Français v7           ║');
  log('╚══════════════════════════════════════════════════╝');

  let totalCreated=0, totalUpdated=0, totalErrors=0;

  for (const societe of SOCIETES) {
    try {
      const stats = await processSociete(societe);
      totalCreated += stats.created||0;
      totalUpdated += stats.updated||0;
      totalErrors  += stats.errors||0;
    } catch(e) {
      log(`❌ ERREUR ${societe.nom}: ${e.message}`);
      totalErrors++;
    }
    await new Promise(r => setTimeout(r, 2000));
  }

  log('\n━━━ Push données vers GitHub ━━━');
  try {
    const date = new Date().toLocaleString('fr-FR');
    execSync(
      `cd C:\\anapec && git stash && git pull origin main --rebase && git stash pop && git add -A && git commit -m "Données 8 sociétés v7 - ${date}" && git push origin main`,
      { stdio:'inherit', timeout:60000 }
    );
    log('✅ Données pushées vers GitHub');
  } catch(e) {
    try {
      const date = new Date().toLocaleString('fr-FR');
      execSync(`cd C:\\anapec && git add -A && git commit -m "v7 - ${date}" && git push origin main --force-with-lease`,
        { stdio:'inherit', timeout:60000 });
      log('✅ Données pushées (force)');
    } catch(e2) { log(`⚠️ Git: ${e.message.substring(0,100)}`); }
  }

  log('\n╔══════════════════════════════════════════════════╗');
  log(`║  FIN: +${totalCreated} créés, ↻${totalUpdated} mis à jour, ✗${totalErrors} erreurs  ║`);
  log('╚══════════════════════════════════════════════════╝\n');
}

main().catch(e => { log(`ERREUR CRITIQUE: ${e.message}`); process.exit(1); });
