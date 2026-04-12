// ============================================================
// run_all.mjs - Pipeline complet pour les 8 sociétés
// CORRIGÉ v2: Extraction salaire décimale + durée + poste améliorée
// ============================================================

import { execSync } from 'child_process';
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync, unlinkSync } from 'fs';
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

// ── CORRECTION PRINCIPALE: parseDetail bilingue ──────────────
function parseDetail(html) {
  // Détecter si c'est du texte pur (innerText) ou du HTML
  const isPlainText = !html.includes('<html') && !html.includes('<body') && !html.includes('<script');
  const text = isPlainText ? html.replace(/[ \t]+/g, ' ').replace(/\r\n/g, '\n') : html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/td>/gi, '\n')
    .replace(/<\/th>/gi, '\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\r\n/g, '\n');

  // Détection automatique de la langue
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
    // ── Parsing FRANÇAIS ─────────────────────────────────────
    return {
      agence: find(/Agence\s*:\s*([^\n<]{3,60})/i),

      nom_entrep: find(/Nom\s+ou\s+raison\s+sociale\s*[:\u00a0]+\s*([^\n<]{2,80})/i),

      secteur: find(/Secteur\s+d.activit[eé]\s*:\s*([^\n<]{3,80})/i),

      adresse: find(/Adresse\s*:\s*([^\n<]{5,150})/i),

      telephone: (() => {
        const m = text.match(/T[eé]l[^:\n]*:\s*([\d\/\s+.]{7,30})/i);
        if (m) {
          const nums = m[1].match(/(0\d{9})/g);
          return nums ? nums[0] : m[1].trim();
        }
        return text.match(/(0[567]\d{8})/)?.[1] || '';
      })(),

      rc: find(/registre\s+du\s+[Cc]ommerce\s*:\s*(\d+)/i),

      cnss_empl: find(/affiliation\s+.+C\.N\.S\.S[^:]*:\s*(\d+)/i),

      forme_jur: find(/Statut\s+juridique\s*:\s*([^\n<]{3,60})/i),

      nom_agent: (() => {
        const m = text.match(/Nom\s+et\s+pr[eé]nom\s*[:\u00a0]+\s*([A-Z][A-Z\s]{1,40}?)\s{2,}([A-Z][^\n<]{1,40})/);
        if (m) return m[1].trim();
        const m2 = text.match(/Nom\s+et\s+pr[eé]nom\s*[:\u00a0]+\s*([A-Z][^\n<]{3,60})/i);
        if (m2) {
          const parts = m2[1].trim().split(/\s+/);
          return parts.length > 1 ? parts.slice(0, -1).join(' ') : parts[0];
        }
        return '';
      })(),

      prenom: (() => {
        const m = text.match(/Nom\s+et\s+pr[eé]nom\s*[:\u00a0]+\s*([A-Z][A-Z\s]{1,40}?)\s{2,}([A-Z][^\n<]{1,40})/);
        if (m) return m[2].trim();
        const m2 = text.match(/Nom\s+et\s+pr[eé]nom\s*[:\u00a0]+\s*([A-Z][^\n<]{3,60})/i);
        if (m2) {
          const parts = m2[1].trim().split(/\s+/);
          return parts.length > 1 ? parts[parts.length - 1] : '';
        }
        return '';
      })(),

      nationalite: find(/Nationalit[eé]\s*:\s*([^\n<]{3,30})/i),

      cin: (() => {
        const m = text.match(/CIN[^:]*:\s*([A-Z]{1,2}\d{5,8})/i)
                 || text.match(/\b([A-Z]{1,2}\d{5,8})\b/);
        return m?.[1] || '';
      })(),

      cnss_agent: find(/immatriculation\s+.+C\.N\.S\.S[^:]*:\s*(\d{6,12})/i),

      niveau: find(/Niveau\s+d.instruction[^:]*:\s*([^\n<]{3,80})/i),

      // ── POSTE : extraction améliorée ──────────────────────────
      poste: (() => {
        // Pattern 1 : "affecter au poste de travail ..."
        const m1 = text.match(/affecter\s+au\s+poste\s+de\s+(?:travail\s+)?([^\n.<]{3,80})/i);
        if (m1) return m1[1].trim();

        // Pattern 2 : "occuper le poste de ..."
        const m2 = text.match(/occuper\s+le\s+poste\s+de\s+([^\n.<]{3,80})/i);
        if (m2) return m2[1].trim();

        // Pattern 3 : "poste : XXXX" ou "Poste de travail : XXXX"
        const m3 = text.match(/[Pp]oste\s+(?:de\s+travail\s*)?:\s*([^\n<]{3,60})/);
        if (m3) return m3[1].trim();

        // Pattern 4 : chercher le mot-clé du poste en MAJUSCULES dans le texte
        const zone = (() => {
          const idx = text.search(/[Cc]ontrat|[Ee]ngagement/);
          return idx > 0 ? text.slice(idx) : text;
        })();
        const jobPatterns = [
          /AGENT\s+DE\s+GARDIENNAGE/i,
          /HOTESSE\s+D[''\u2019]?ACCUEIL/i,
          /CHARGE[E]?\s+D[''\u2019]?(?:APPEL|AFFAIRE|CLIENTELE)[^\n,.]{0,40}/i,
          /TECHNICIEN[^\n,.]{0,40}/i,
          /AGENT\s+[A-Z]{3,}[^\n,.]{0,30}/i,
          /RESPONSABLE\s+[A-Z]{3,}[^\n,.]{0,30}/i,
          /CHAUFFEUR[^\n,.]{0,30}/i,
          /OPERATEUR[^\n,.]{0,30}/i,
          /CHARGE[E]?\s+[A-Z]{3,}[^\n,.]{0,30}/i,
        ];
        for (const jp of jobPatterns) {
          const m = zone.match(jp);
          if (m && m[0].length > 4 &&
              !m[0].toUpperCase().includes('ENGAGEMENT') &&
              !m[0].toUpperCase().includes('CONVENTION') &&
              !m[0].toUpperCase().includes('CONTRAT')) {
            return m[0].trim();
          }
        }
        return '';
      })(),

      // ── DURÉE : extraction améliorée (capture décimales et variantes) ─
      duree: (() => {
        // Pattern 1 : "pour une durée de 24 mois" / "d'une durée de 24 mois"
        const m1 = text.match(/dur[eé]e\s+(?:de\s+)?(?:\(\d+\)\s*)?(\d+)\s*mois/i);
        if (m1) return m1[1];

        // Pattern 2 : "(1) 21 mois" → prendre le 2ème nombre (durée réelle)
        const m2 = text.match(/\(\d+\)\s*(\d+)\s*mois/i);
        if (m2) return m2[1];

        // Pattern 3 : "pendant XX mois"
        const m3 = text.match(/pendant\s+(\d+)\s+mois/i);
        if (m3) return m3[1];

        // Pattern 4 : "X mois non renouvelables" ou "X mois renouvelables"
        const m4 = text.match(/(\d+)\s+mois\s+(?:non\s+)?renouvela/i);
        if (m4) return m4[1];

        // Pattern 5 : Durée avec tiret ou deux-points "Durée : 24"
        const m5 = text.match(/[Dd]ur[eé]e\s*[:\-]\s*(\d+)/);
        if (m5) return m5[1];

        return '';
      })(),

      // ── SALAIRE : extraction améliorée avec décimales ─────────
      salaire: (() => {
        // Pattern 1 : "fixé à 3192.72 DH" ou "fixé à 3 192,72 DH"
        const m1 = text.match(/fix[eé]\s+[àa]\s+([\d\s.,]+)\s*DH/i);
        if (m1) {
          // Normaliser : enlever espaces, remplacer virgule par point
          const val = m1[1].replace(/\s/g, '').replace(',', '.');
          if (parseFloat(val) > 0) return val;
        }

        // Pattern 2 : "montant de XXXX DH (" — avant la parenthèse
        const m2 = text.match(/([\d\s.,]{4,10})\s*DH\s*\(/i);
        if (m2) {
          const val = m2[1].replace(/\s/g, '').replace(',', '.');
          if (parseFloat(val) > 0) return val;
        }

        // Pattern 3 : "montant ... est de XXXX DH"
        const m3 = text.match(/est\s+de\s+([\d\s.,]+)\s*DH/i);
        if (m3) {
          const val = m3[1].replace(/\s/g, '').replace(',', '.');
          if (parseFloat(val) > 0) return val;
        }

        // Pattern 4 : "d'un montant de XXXX DH"
        const m4 = text.match(/montant\s+de\s+([\d\s.,]+)\s*DH/i);
        if (m4) {
          const val = m4[1].replace(/\s/g, '').replace(',', '.');
          if (parseFloat(val) > 0) return val;
        }

        // Pattern 5 : chercher un montant entre 1000 et 20000 avant "DH"
        const m5 = text.match(/\b(\d{1,2}[\s]?\d{3}(?:[.,]\d{1,2})?)\s*DH/i);
        if (m5) {
          const val = m5[1].replace(/\s/g, '').replace(',', '.');
          if (parseFloat(val) >= 1000 && parseFloat(val) <= 20000) return val;
        }

        return '';
      })(),
    };

  } else {
    // ── Parsing ARABE ─────────────────────────────────────────
    return {
      agence:     find(/الوكالة\s*:\s*([^\n|]{3,60})/),
      nom_entrep: find(/الاسم [أا]و المقاول[^:\n]*:\s*([^\n]{3,80})/) || (text.match(/GRUPO[^\n,]*/)?.[0] || ''),
      secteur:    find(/قطاع النشاط[^:\n]*:\s*([^\n]{3,80})/) || (text.match(/Services fournis[^\n]*/)?.[0] || ''),
      adresse:    find(/العنوان\s*:\s*([^\n]{5,150})/),
      telephone:  find(/(0\d{8,9})/),
      rc:         find(/رقم القيد في السجل التجاري[^:\n]*:\s*(\d+)/),
      cnss_empl:  find(/رقم الانخراط[^:\n]*:\s*(\d+)/),
      forme_jur:  find(/النظام القانوني[^:\n]*:\s*([^\n]{3,60})/),
      nom_agent: (() => {
        const s1 = find(/الاسم العائلي[^:\n]*:\s*([^\n]{2,40})/);
        if (s1) return s1;
        const s2 = find(/الاسم المالي والشخصي[^:\n]*:\s*([^\n]{2,60})/);
        if (s2) return s2.trim().split(/\s+/)[0] || '';
        const cinMatch = text.match(/\b([A-Z]{1,2}\d{5,8})\b/);
        if (cinMatch) {
          const cinIdx = text.indexOf(cinMatch[1]);
          const before = text.slice(Math.max(0, cinIdx-300), cinIdx);
          const arabicWords = before.match(/[\u0600-\u06FF]{3,}/g);
          if (arabicWords && arabicWords.length >= 2) {
            const reversed = arabicWords[arabicWords.length-2].split('').reverse().join('');
            return reversed;
          }
        }
        return '';
      })(),
      prenom: (() => {
        const s1 = find(/الاسم الشخصي[^:\n]*:\s*([^\n]{2,40})/);
        if (s1) return s1;
        const s2 = find(/الاسم المالي والشخصي[^:\n]*:\s*([^\n]{2,60})/);
        if (s2) { const p = s2.trim().split(/\s+/); return p.length > 1 ? p.slice(1).join(' ') : ''; }
        const cinMatch = text.match(/\b([A-Z]{1,2}\d{5,8})\b/);
        if (cinMatch) {
          const cinIdx = text.indexOf(cinMatch[1]);
          const before = text.slice(Math.max(0, cinIdx-300), cinIdx);
          const arabicWords = before.match(/[\u0600-\u06FF]{3,}/g);
          if (arabicWords && arabicWords.length >= 1) {
            const reversed = arabicWords[arabicWords.length-1].split('').reverse().join('');
            return reversed;
          }
        }
        return '';
      })(),
      nationalite: find(/الجنسية[^:\n]*:\s*([^\n]{3,30})/),
      cin:         text.match(/\b([A-Z]{1,2}\d{5,8})\b/)?.[1] || '',
      cnss_agent:  find(/رقم التسجيل بالصندوق[^:\n]*:\s*(\d{6,12})/),
      niveau:      find(/المستوى التعليمي[^:\n]*:\s*([^\n]{3,60})/),
      poste: (() => {
        // Chercher المهنة
        const s1 = find(/المهنة[^:\n]*:\s*([^\n]{3,60})/);
        if (s1) return s1;
        // Chercher تعيينه/تعيين في منصب
        const s2 = find(/تعيين[^\n]*?:\s*([^\n]{3,60})/);
        if (s2) return s2;
        // Chercher العمل كـ (poste après العمل)
        const s3 = text.match(/العمل[^\n]*?(AGENT[^\n,.]{3,40}|HOTESSE[^\n,.]{3,40}|CHARGE[^\n,.]{3,40}|TECHNICIEN[^\n,.]{3,40})/i);
        if (s3) return s3[1].trim();
        // Chercher dans la section engagements
        const bodyIdx = text.indexOf('Contrat');
        const searchZone = bodyIdx > 0 ? text.slice(bodyIdx) : text;
        const jobPatterns = [
          /AGENT\s+DE\s+GARDIENNAGE/i,
          /HOTESSE\s+D[''\u2019]?ACCUEIL/i,
          /CHARGE[E]?\s+D[''\u2019]?(?:APPEL|AFFAIRE|CLIENTELE)[^\n,.]{0,40}/i,
          /TECHNICIEN[^\n,.]{0,40}/i,
          /AGENT\s+[A-Z]{3,}[^\n,.]{0,30}/i,
          /RESPONSABLE\s+[A-Z]{3,}[^\n,.]{0,30}/i,
          /([A-Z]{5,}(?:\s+(?:DE|DU|D|AU|AUX|ET)\s+)?(?:[A-Z]{3,}\s*){0,3})/,
        ];
        for (const jp of jobPatterns) {
          const m = searchZone.match(jp);
          if (m && m[0].length > 4 &&
              !m[0].toUpperCase().includes('ENGAGEMENT') &&
              !m[0].toUpperCase().includes('CONVENTION') &&
              !m[0].toUpperCase().includes('CONTRAT')) {
            return m[0].trim();
          }
        }
        return '';
      })(),
      // ── DURÉE arabe : améliorée ───────────────────────────────
      duree: (() => {
        // المدة : 24
        const s1 = find(/المدة[^:\n]*:\s*(\d+)/);
        if (s1) return s1;
        // مدة XXXX شهرا
        const s2 = text.match(/مدة[^\d]*(\d+)\s*شهر/);
        if (s2) return s2[1];
        // لمدة XX شهراً
        const s3 = text.match(/لمدة[^\d]*(\d+)/);
        if (s3) return s3[1];
        return '';
      })(),
      // ── SALAIRE arabe : amélioré ──────────────────────────────
      salaire: (() => {
        // الأجر : 3192.72
        const s1 = find(/الأجر[^:\n]*:\s*([\d\s.,]+)/);
        if (s1) return s1.replace(/[^\d.,]/g, '').replace(',', '.');

        // بحد أعلى XXXX درهم
        const s2 = text.match(/بحد أعلى\s*([\d\s.,]+)\s*درهم/);
        if (s2) return s2[1].replace(/\s/g, '').replace(',', '.');

        // XXXX,XX درهم ou XXXX.XX درهم
        const s3 = text.match(/([\d]{3,6}(?:[.,]\d{1,2})?)\s*درهم/);
        if (s3) return s3[1].replace(',', '.');

        // تخويله XXXX
        const s4 = text.match(/تخويله[^\d]*([\d]{3,6}(?:[.,]\d{1,2})?)/);
        if (s4) return s4[1].replace(',', '.');

        // منحة مالية ... XXXX
        const s5 = text.match(/منحة[^\d]*([\d]{3,6}(?:[.,]\d{1,2})?)/);
        if (s5) return s5[1].replace(',', '.');

        return '';
      })(),
    };
  }
}

// ── Détecte si un fichier HTML est en français ────────────────
function isFrenchHtml(html) {
  return html.includes('EMPLOYEUR') || html.includes('Employeur') ||
         html.includes('STAGIAIRE') || html.includes('raison sociale') ||
         html.includes('CONVENTION');
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
  if (!existsSync(societeDir)) mkdirSync(societeDir, { recursive: true });

  log(`\n━━━ ${societe.nom} (${societe.email}) ━━━`);

  // ── Supprimer cache HTML ancien ou français non parsé ────────
  const existingHtml = existsSync(societeDir)
    ? readdirSync(societeDir).filter(f => f.startsWith('ci_') && f.endsWith('.html'))
    : [];

  let deleted = 0;
  for (const file of existingHtml) {
    const filePath = join(societeDir, file);
    try {
      const content = readFileSync(filePath, 'utf8');
      if (isFrenchHtml(content)) {
        const parsed = parseDetail(content);
        const hasData = parsed.nom_entrep || parsed.nom_agent || parsed.salaire || parsed.poste;
        if (!hasData) {
          unlinkSync(filePath);
          deleted++;
        }
      }
    } catch(e) {}
  }
  if (deleted > 0) log(`  🗑️ ${deleted} fichiers HTML français re-scraper (cache invalide supprimé)`);

  // ── Scraping ──────────────────────────────────────────────
  log(`  Scraping ANAPEC...`);
  try {
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
  const cinMap = {};
  for (const file of files) {
    const html = readFileSync(join(societeDir, file), 'utf8');
    const detail = parseDetail(html);
    const cleanText = html.replace(/<[^>]+>/g,' ');

    const refMatch = cleanText.match(/([A-Z]{0,3}\d{8,}\/\d+)/);
    let ref = refMatch?.[1] || '';
    if (ref.match(/^I\d/)) ref = 'A' + ref;
    if (ref) {
      detailMap[ref] = detail;
      detailMap[ref.replace(/^A/,'')] = detail;
      if (ref.startsWith('NO')) detailMap[ref.slice(2)] = detail;
      if (ref.startsWith('NI')) detailMap[ref.slice(2)] = detail;
    }

    const cinMatch = cleanText.match(/([A-Z]{1,2}\d{5,8})/);
    if (cinMatch?.[1]) cinMap[cinMatch[1]] = detail;
  }

  const contracts = baseContracts.map(c => {
    const merged = {
      ref: c.ref || '', date_sig: c.date_sig || '', date_fin: c.date_fin || '',
      etat: c.etat || '', type: c.type || '', cin: c.cin || '',
      ...(detailMap[c.ref] || cinMap[c.cin] || {})
    };

    // ── Nettoyer poste si vide ou générique ───────────────────
    const badPostes = ['من جهة أخرى', 'من جهة', 'تم الاتفاق', 'الالتزامات', 'المتدرب'];
    const posteIsInvalid = !merged.poste || badPostes.some(b => merged.poste.includes(b));
    if (posteIsInvalid) {
      merged.poste = '';
      for (const f of files) {
        try {
          const h = readFileSync(join(societeDir, f), 'utf8');
          // Matcher par CIN ou ref
          const cinOk = c.cin && h.includes(c.cin);
          const refOk = c.ref && h.includes(c.ref);
          if (!cinOk && !refOk) continue;
          const cleanH = h.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g,' ');
          const jobPatterns = [
            /AGENT\s+DE\s+GARDIENNAGE/i,
            /HOTESSE\s+D[''\u2019]?ACCUEIL/i,
            /CHARGE[E]?\s+D[''\u2019]?(?:APPEL|AFFAIRE|CLIENTELE)[^\n,.]{0,40}/i,
            /TECHNICIEN[^\n,.]{0,40}/i,
            /AGENT\s+[A-Z]{3,}[^\n,.]{0,30}/i,
            /RESPONSABLE\s+[A-Z]{3,}[^\n,.]{0,30}/i,
            /CHAUFFEUR[^\n,.]{0,30}/i,
            /OPERATEUR[^\n,.]{0,30}/i,
            /affecter\s+au\s+poste\s+de\s+(?:travail\s+)?([^\n.<]{3,80})/i,
            /occuper\s+le\s+poste\s+de\s+([^\n.<]{3,80})/i,
          ];
          for (const jp of jobPatterns) {
            const pm = cleanH.match(jp);
            if (pm) {
              const val = (pm[1] || pm[0]).trim();
              if (val.length > 3 &&
                  !val.toUpperCase().includes('ENGAGEMENT') &&
                  !val.toUpperCase().includes('CONVENTION')) {
                merged.poste = val;
                break;
              }
            }
          }
          if (merged.poste) break;
        } catch {}
      }
    }

    // ── Nettoyer salaire si vide ou 0 ─────────────────────────
    if (!merged.salaire || merged.salaire === '0') {
      for (const f of files) {
        try {
          const h = readFileSync(join(societeDir, f), 'utf8');
          const cinOk = c.cin && h.includes(c.cin);
          const refOk = c.ref && h.includes(c.ref);
          if (!cinOk && !refOk) continue;
          const cleanH = h.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g,' ');
          // Essayer tous les patterns salaire
          const patterns = [
            /fix[eé]\s+[àa]\s+([\d\s.,]+)\s*DH/i,
            /([\d\s.,]{4,10})\s*DH\s*\(/i,
            /montant\s+de\s+([\d\s.,]+)\s*DH/i,
            /بحد أعلى\s*([\d\s.,]+)\s*درهم/,
            /([\d]{3,6}(?:[.,]\d{1,2})?)\s*درهم/,
            /تخويله[^\d]*([\d]{3,6}(?:[.,]\d{1,2})?)/,
          ];
          for (const sp of patterns) {
            const sm = cleanH.match(sp);
            if (sm) {
              const val = sm[1].replace(/\s/g, '').replace(',', '.');
              if (parseFloat(val) >= 500 && parseFloat(val) <= 20000) {
                merged.salaire = val;
                break;
              }
            }
          }
          if (merged.salaire && merged.salaire !== '0') break;
        } catch {}
      }
    }

    // ── Nettoyer durée si vide ────────────────────────────────
    if (!merged.duree) {
      for (const f of files) {
        try {
          const h = readFileSync(join(societeDir, f), 'utf8');
          const cinOk = c.cin && h.includes(c.cin);
          const refOk = c.ref && h.includes(c.ref);
          if (!cinOk && !refOk) continue;
          const cleanH = h.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g,' ');
          const dPatterns = [
            /dur[eé]e\s+(?:de\s+)?(?:\(\d+\)\s*)?(\d+)\s*mois/i,
            /\(\d+\)\s*(\d+)\s*mois/i,
            /pendant\s+(\d+)\s+mois/i,
            /(\d+)\s+mois\s+(?:non\s+)?renouvela/i,
            /المدة[^:\n]*:\s*(\d+)/,
            /لمدة[^\d]*(\d+)/,
          ];
          for (const dp of dPatterns) {
            const dm = cleanH.match(dp);
            if (dm) { merged.duree = dm[1]; break; }
          }
          if (merged.duree) break;
        } catch {}
      }
    }

    return merged;
  });

  // Log diagnostic pour vérification
  const sampleMissing = contracts.filter(c => !c.poste || !c.salaire || !c.duree);
  if (sampleMissing.length > 0) {
    log(`  ⚠️ ${sampleMissing.length} contrats avec champs manquants (poste/salaire/durée)`);
    sampleMissing.slice(0, 3).forEach(c => {
      log(`     - ${c.ref}: poste="${c.poste||'?'}" salaire="${c.salaire||'?'}" durée="${c.duree||'?'}"`);
    });
  }

  // ── Envoyer à Lambda ──────────────────────────────────────
  return await sendToLambda(contracts, societe.nom);
}

async function main() {
  log('\n╔══════════════════════════════════════════════════╗');
  log('║  PIPELINE MULTI-SOCIÉTÉS ANAPEC → Monday.com    ║');
  log('║  VERSION: Bilingue Arabe + Français v2           ║');
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
