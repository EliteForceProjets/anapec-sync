// ============================================================
// run_all.mjs - Pipeline complet pour les 8 sociétés
// CORRIGÉ v5: FIX CRITIQUE - extraire section .printable
//             avant suppression des scripts JS
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
// extractPrintable — FIX CRITIQUE v5
//
// PROBLÈME DIAGNOSTIQUÉ : le texte arabe (لمدة, مبلغها, تعيين)
// existe DANS LE CODE JAVASCRIPT inline du fichier HTML (dans
// des variables encodées). Quand on retire les <script> en premier
// puis on cherche le texte → RIEN. Mais si on ne retire pas les
// scripts → on matche dans le JS au lieu du contenu réel.
//
// SOLUTION : extraire d'abord la section <div class="printable">
// qui contient UNIQUEMENT le contenu du contrat, puis parser.
// Si pas de .printable → fallback sur le body sans scripts.
// ─────────────────────────────────────────────────────────────
function extractPrintable(html) {
  // Stratégie 1 : extraire div.printable (section contrat ANAPEC)
  const printableMatch = html.match(/<div[^>]*class=["'][^"']*printable[^"']*["'][^>]*>([\s\S]*?)<\/div>\s*<\/div>/i)
                      || html.match(/<div[^>]*class=["'][^"']*printable[^"']*["'][^>]*>([\s\S]*)/i);
  if (printableMatch) return printableMatch[1];

  // Stratégie 2 : extraire <body> sans les scripts
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  const body = bodyMatch ? bodyMatch[1] : html;

  // Retirer les scripts
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
// parseDetail v5 — utilise extractPrintable
// ─────────────────────────────────────────────────────────────
function parseDetail(html) {
  // FIX v5 : extraire la section printable AVANT tout traitement
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

      // POSTE français
      poste: (() => {
        const m1 = text.match(/affecter\s+au\s+poste\s+de\s+(?:travail\s+)?([^\n.<]{3,80})/i);
        if (m1) return m1[1].trim().replace(/\s*\.$/, '');
        const m2 = text.match(/occuper\s+le\s+poste\s+de\s+(?:travail\s+)?([^\n.<]{3,80})/i);
        if (m2) return m2[1].trim().replace(/\s*\.$/, '');
        const m3 = text.match(/[Pp]oste\s+(?:de\s+travail\s*)?:\s*([^\n<.]{3,60})/);
        if (m3) return m3[1].trim();
        return '';
      })(),

      // DURÉE française : "Pour une durée de (1) 23 mois"
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

      // SALAIRE français : "fixé à 2500 DH (entre 1600 et 6000 DH)"
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
    // ARABE — FIX v5 :
    // Le salaire contient "&nbsp;" : "مبلغها في &nbsp;1600 درهم"
    // → après htmlToText, &nbsp; devient espace normal ✅
    // La durée est dans la section printable, pas dans le JS ✅
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

      // POSTE arabe : "تعيينه (ها) :الشغل AGENT DE NETTOYAGE"
      // Minuscules ou majuscules → flag i + toUpperCase()
      poste: (() => {
        const m1 = text.match(/تعيين[^\n:]*:\s*(?:الشغل\s*)?([A-Za-z][A-Za-z\s''\u2019\-]{3,60})/i);
        if (m1) return m1[1].trim().replace(/\s*[.،]\s*$/, '').toUpperCase();
        const m2 = text.match(/الشغل\s+([A-Za-z][A-Za-z\s''\u2019\-]{3,60})/i);
        if (m2) return m2[1].trim().replace(/\s*[.،]\s*$/, '').toUpperCase();
        const m3 = text.match(/المهنة[^:\n]*:\s*([^\n]{3,60})/);
        if (m3) return m3[1].trim();
        return '';
      })(),

      // DURÉE arabe : "لمدة 1 12 شهرا (12 شهرا غير قابلة للتجديد)"
      // FIX v5 : le texte vient de la section printable uniquement
      // → plus de confusion avec le JS
      // Le &nbsp; entre "في" et "1600" est converti en espace par htmlToText
      duree: (() => {
        // "لمدة [note] [duree] شهر" — note = 1 chiffre
        const m1 = text.match(/لمدة\s+(\d)\s+(\d+)\s+شهر/);
        if (m1) return m1[2]; // prendre le 2ème nombre = vraie durée
        // Sans note : "لمدة 12 شهرا"
        const m2 = text.match(/لمدة\s+(\d+)\s+شهر/);
        if (m2) return m2[1];
        // المدة : X
        const m3 = find(/المدة[^:\n]*:\s*(\d+)/);
        if (m3) return m3;
        // "(12 شهرا غير قابلة)" — parenthèse de confirmation
        const m4 = text.match(/\((\d+)\s+شهر[اً]?\s+غير\s+قابلة/);
        if (m4) return m4[1];
        return '';
      })(),

      // SALAIRE arabe : "مبلغها في  1600 درهم"
      // FIX v5 : le &nbsp; est converti en espace par htmlToText
      // → \s+ capture l'espace même s'il y en a plusieurs
      salaire: (() => {
        // "مبلغها في [espaces] XXXX درهم"
        const m1 = text.match(/مبلغها\s+في\s+([\d.,]+)\s*درهم/);
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

  // Supprimer cache HTML invalide
  const existingHtml = existsSync(societeDir)
    ? readdirSync(societeDir).filter(f => f.startsWith('ci_') && f.endsWith('.html'))
    : [];
  let deleted = 0;
  for (const file of existingHtml) {
    try {
      const c = readFileSync(join(societeDir, file), 'utf8');
      if (isFrenchHtml(c)) {
        const p = parseDetail(c);
        if (!p.nom_entrep && !p.nom_agent && !p.salaire && !p.poste) {
          unlinkSync(join(societeDir, file)); deleted++;
        }
      }
    } catch(e) {}
  }
  if (deleted > 0) log(`  🗑️ ${deleted} fichiers invalides supprimés`);

  log(`  Scraping ANAPEC...`);
  try {
    const env = { ...process.env, ANAPEC_EMAIL: societe.email, ANAPEC_PASSWORD: societe.password, ANAPEC_OUT_DIR: societeDir };
    execSync(`node C:\\anapec\\scraper_anapec.mjs`, { stdio:'inherit', timeout:300000, env });
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

  // Construire les maps
  const files = readdirSync(societeDir).filter(f => f.startsWith('ci_') && f.endsWith('.html'));
  const detailMap = {};
  const cinMap    = {};

  for (const file of files) {
    const html = readFileSync(join(societeDir, file), 'utf8');
    const detail = parseDetail(html);
    const cleanText = html.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ');

    // Mapping par toutes les refs trouvées
    const refs = [...cleanText.matchAll(/\b([A-Z]{0,3}\d{8,}\/\d+)\b/g)].map(m=>m[1]);
    for (let ref of [...new Set(refs)]) {
      if (ref.match(/^I\d/)) ref = 'A' + ref;
      detailMap[ref] = detail;
      detailMap[ref.replace(/^A/,'')] = detail;
      if (ref.startsWith('NO')) detailMap[ref.slice(2)] = detail;
      if (ref.startsWith('NI')) detailMap[ref.slice(2)] = detail;
      if (ref.startsWith('AL')) detailMap[ref.slice(2)] = detail;
    }
    // Mapping par CIN
    const cins = [...cleanText.matchAll(/\b([A-Z]{1,2}\d{5,8})\b/g)].map(m=>m[1]);
    for (const cin of [...new Set(cins)]) cinMap[cin] = detail;
  }

  const contracts = baseContracts.map(c => {
    const merged = {
      ref: c.ref||'', date_sig: c.date_sig||'', date_fin: c.date_fin||'',
      etat: c.etat||'', type: c.type||'', cin: c.cin||'',
      ...(detailMap[c.ref] || cinMap[c.cin] || {})
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
  log('║  VERSION: Bilingue Arabe + Français v5           ║');
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

  // Push GitHub : stash → pull → pop → push
  log('\n━━━ Push données vers GitHub ━━━');
  try {
    const date = new Date().toLocaleString('fr-FR');
    execSync(
      `cd C:\\anapec && git stash && git pull origin main --rebase && git stash pop && git add -A && git commit -m "Données 8 sociétés v5 - ${date}" && git push origin main`,
      { stdio:'inherit', timeout:60000 }
    );
    log('✅ Données pushées vers GitHub');
  } catch(e) {
    try {
      const date = new Date().toLocaleString('fr-FR');
      execSync(`cd C:\\anapec && git add -A && git commit -m "v5 - ${date}" && git push origin main --force-with-lease`,
        { stdio:'inherit', timeout:60000 });
      log('✅ Données pushées (force)');
    } catch(e2) { log(`⚠️ Git: ${e.message.substring(0,100)}`); }
  }

  log('\n╔══════════════════════════════════════════════════╗');
  log(`║  FIN: +${totalCreated} créés, ↻${totalUpdated} mis à jour, ✗${totalErrors} erreurs  ║`);
  log('╚══════════════════════════════════════════════════╝\n');
}

main().catch(e => { log(`ERREUR CRITIQUE: ${e.message}`); process.exit(1); });
