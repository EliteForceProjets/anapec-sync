// ============================================================
// sync_weekly.mjs - Synchronisation hebdomadaire ANAPEC → Monday
// S'exécute automatiquement chaque dimanche à 8h00
// ============================================================

import { readFileSync, readdirSync, writeFileSync, existsSync } from 'fs';

const MONDAY_API_KEY = 'eyJhbGciOiJIUzI1NiJ9.eyJ0aWQiOjQ0MjgwOTc1MCwiYWFpIjoxMSwidWlkIjo0MDc5NzY3NywiaWFkIjoiMjAyNC0xMS0yOVQyMDo0MzozNS4wMDBaIiwicGVyIjoibWU6d3JpdGUiLCJhY3RpZCI6MTU1OTc4MTUsInJnbiI6ImV1YzEifQ.kDaFO4cuWLy4Q4PbCe7mLuAGvbRRZAshbvuRG-b3b6U';
const BOARD_ID = '5094200598';
const LOG_FILE = 'C:\\anapec\\sync_log.txt';

function log(msg) {
  const line = `[${new Date().toLocaleString('fr-FR')}] ${msg}`;
  console.log(line);
  try {
    const existing = existsSync(LOG_FILE) ? readFileSync(LOG_FILE, 'utf8') : '';
    writeFileSync(LOG_FILE, existing + line + '\n');
  } catch(e) {}
}

const COL = {
  ref:        'text_mm25bmx6',
  etat:       'color_mm25jvb9',
  type:       'text_mm25cnhq',
  date_sig:   'date_mm25j55f',
  date_fin:   'date_mm25dgst',
  agence:     'text_mm255qz2',
  nom_entrep: 'text_mm25b5td',
  secteur:    'text_mm25anzf',
  adresse:    'text_mm25sj8x',
  telephone:  'phone_mm25494m',
  cnss_empl:  'text_mm25pz5s',
  rc:         'text_mm25qwwm',
  forme_jur:  'text_mm25c1zg',
  nom_agent:  'text_mm256r65',
  prenom:     'text_mm25rm0q',
  nationalite:'text_mm257ne0',
  cin:        'text_mm25ycje',
  cnss_agent: 'text_mm25vspv',
  niveau:     'text_mm25dcs7',
  poste:      'text_mm25x2aw',
  duree:      'numeric_mm25fr45',
  salaire:    'numeric_mm25aj7f',
  cnss_trait: 'color_mm253wpv'
};

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

async function mondayQuery(query) {
  const res = await fetch('https://api.monday.com/v2', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': MONDAY_API_KEY,
      'API-Version': '2024-01'
    },
    body: JSON.stringify({ query })
  });
  return res.json();
}

async function getMondayItems() {
  const data = await mondayQuery(`{
    boards(ids: ${BOARD_ID}) {
      items_page(limit: 100) {
        items { id name column_values { id text } }
      }
    }
  }`);
  return data.data?.boards?.[0]?.items_page?.items || [];
}

async function createItem(groupId, name, cv) {
  const s = JSON.stringify(JSON.stringify(cv));
  return mondayQuery(`mutation {
    create_item(board_id: ${BOARD_ID}, group_id: "${groupId}",
    item_name: "${name.replace(/"/g,'')}",
    column_values: ${s}) { id }
  }`);
}

async function updateItem(itemId, cv) {
  const s = JSON.stringify(JSON.stringify(cv));
  return mondayQuery(`mutation {
    change_multiple_column_values(board_id: ${BOARD_ID},
    item_id: ${itemId}, column_values: ${s}) { id }
  }`);
}

function buildCV(contract) {
  const cv = {};
  const set = (col, val) => { if (val?.toString().trim()) cv[col] = val.toString().trim(); };
  const setNum = (col, val) => {
    const n = parseFloat(String(val||'').replace(/[^\d.]/g,''));
    if (!isNaN(n) && n > 0) cv[col] = n;
  };
  const setDate = (col, val) => {
    if (!val || val === '---') return;
    const p = String(val).split('/');
    if (p.length === 3) cv[col] = { date: `${p[2]}-${p[1]}-${p[0]}` };
  };

  set(COL.ref, contract.ref);
  set(COL.type, contract.type);
  set(COL.cin, contract.cin);
  setDate(COL.date_sig, contract.date_sig);
  setDate(COL.date_fin, contract.date_fin);
  set(COL.agence, contract.agence);
  set(COL.nom_entrep, contract.nom_entrep);
  set(COL.secteur, contract.secteur);
  set(COL.adresse, contract.adresse);
  set(COL.rc, contract.rc);
  set(COL.cnss_empl, contract.cnss_empl);
  set(COL.forme_jur, contract.forme_jur);
  set(COL.nom_agent, contract.nom_agent);
  set(COL.prenom, contract.prenom);
  set(COL.nationalite, contract.nationalite);
  set(COL.cnss_agent, contract.cnss_agent);
  set(COL.niveau, contract.niveau);
  set(COL.poste, contract.poste);
  setNum(COL.duree, contract.duree);
  setNum(COL.salaire, contract.salaire);

  if (contract.telephone) {
    const tel = String(contract.telephone).replace(/[^\d]/g,'').substring(0,10);
    if (tel.length >= 9) cv[COL.telephone] = { phone: tel, countryShortName: 'MA' };
  }

  const etat = (contract.etat || '').toLowerCase();
  if (etat.includes('validé') || etat.includes('signé')) cv[COL.etat] = { index: 1 };
  else cv[COL.etat] = { index: 0 };

  return cv;
}

async function main() {
  log('========================================');
  log('=== Début synchronisation hebdomadaire ===');

  try {
    // 1. Lire contrats.json
    if (!existsSync('C:\\anapec\\contrats.json')) {
      log('ERREUR: contrats.json non trouvé !');
      log('Veuillez sauvegarder la page ANAPEC (Ctrl+S) et re-générer contrats.json');
      return;
    }

    const baseContracts = JSON.parse(readFileSync('C:\\anapec\\contrats.json', 'utf8'));
    log(`${baseContracts.length} contrats dans contrats.json`);

    // 2. Lire les fichiers détails
    const files = readdirSync('C:\\anapec\\').filter(f => f.startsWith('ci_') && f.endsWith('.html'));
    log(`${files.length} fichiers détails trouvés`);

    const detailMap = {};
    for (const file of files) {
      const html = readFileSync(`C:\\anapec\\${file}`, 'utf8');
      const detail = parseDetail(html);
      const refMatch = html.replace(/<[^>]+>/g,' ').match(/([AI]?\d{10,}\/\d+)/);
      let ref = refMatch?.[1] || '';
      // Normaliser : si commence par I suivi de chiffres → ajouter A
      if (ref.match(/^I\d/)) ref = 'A' + ref;
      if (ref) {
        detailMap[ref] = detail;
        detailMap[ref.replace(/^A/,'')] = detail; // sans A aussi
      }
    }

    // 3. Fusionner
    const contracts = baseContracts.map(c => ({
      ref: c.ref || '', date_sig: c.date_sig || '', date_fin: c.date_fin || '',
      etat: c.etat || '', type: c.type || '', cin: c.cin || '',
      ...(detailMap[c.ref] || {})
    }));

    // 4. Récupérer items Monday
    const items = await getMondayItems();
    const itemByRef = {};
    const itemByName = {};
    items.forEach(item => {
      // Stocker par nom exact
      itemByName[item.name] = item.id;
      // Stocker par nom sans /1 et sans slash
      const nameClean = item.name.replace('/1','').replace('/','');
      itemByName[nameClean] = item.id;
      const refCol = item.column_values.find(c => c.id === COL.ref);
      if (refCol?.text) {
        itemByRef[refCol.text] = item.id;
        itemByRef[refCol.text.replace('/1','').replace('/','')] = item.id;
      }
    });
    log(`${items.length} items existants dans Monday`);

    // 5. Synchroniser
    let created = 0, updated = 0, errors = 0;

    for (const contract of contracts) {
      const ref = contract.ref;
      const isProjet = (contract.etat || '').toLowerCase().includes('projet');
      const groupId = isProjet ? 'group_title' : 'topics';
      const cv = buildCV(contract);
      const existingId = itemByRef[ref] || itemByName[ref];

      try {
        if (existingId) {
          await updateItem(existingId, cv);
          log(`↻ Mis à jour: ${ref}`);
          updated++;
        } else {
          await createItem(groupId, ref, cv);
          log(`+ Créé: ${ref}`);
          created++;
        }
        await new Promise(r => setTimeout(r, 300));
      } catch(e) {
        log(`✗ Erreur ${ref}: ${e.message}`);
        errors++;
      }
    }

    log(`=== FIN: +${created} créés, ↻${updated} mis à jour, ✗${errors} erreurs ===`);
    log('========================================');

  } catch(error) {
    log(`ERREUR CRITIQUE: ${error.message}`);
  }
}

main();
