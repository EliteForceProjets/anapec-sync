// Lambda ANAPEC → Monday.com - Multi-sociétés v8
// FIX v8: move_item_to_group quand l'état change
// Un contrat passé de "Projet" à "Validé & Signé" est maintenant
// déplacé physiquement dans le bon groupe Monday
// FIX v7: pagination cursor-based pour éviter doublons (conservé)
import https from 'https';

const MONDAY_API_KEY = process.env.MONDAY_API_KEY;

const BOARD_MAP = {
  'GRUPO_TEYEZ':    process.env.BOARD_GRUPO_TEYEZ   || '5094533264',
  'SIGARMOR':       process.env.BOARD_SIGARMOR       || '5094533195',
  'EIM':            process.env.BOARD_EIM            || '5094406986',
  'KIRKOS':         process.env.BOARD_KIRKOS         || '5094533165',
  'KIRKOS_GUARD':   process.env.BOARD_KIRKOS_GUARD   || '5094532891',
  'NEISS':          process.env.BOARD_NEISS          || '5094532791',
  'NORIA_BIANCA':   process.env.BOARD_NORIA_BIANCA   || '5094532861',
  'CQ_SERVICE':     process.env.BOARD_CQ_SERVICE     || '5094533129',
  'ANAPEC_GLOBAL':  process.env.BOARD_GLOBAL         || '5094534887',
};

// IDs des groupes Monday (identiques sur tous les boards)
const GROUP_PROJET   = 'group_title'; // groupe PROJET
const GROUP_EN_COURS = 'topics';      // groupe EN COURS

const COL = {
  ref:        'text_mm25bmx6',
  etat:       'text_mm2cq9p4',
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
  cnss_trait: 'color_mm253wpv',
  email_soc:  'text_mm25cb1c',
};

function mondayQuery(query) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ query });
    const req = https.request({
      hostname: 'api.monday.com',
      path: '/v2',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': MONDAY_API_KEY,
        'API-Version': '2024-01',
        'Content-Length': Buffer.byteLength(body)
      }
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch(e) { reject(new Error('JSON parse: ' + data.substring(0,200))); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ─────────────────────────────────────────────────────────────
// getAllMondayItems — pagination cursor-based (FIX v7)
// Récupère TOUS les items avec leur groupe actuel
// ─────────────────────────────────────────────────────────────
async function getAllMondayItems(boardId) {
  const allItems = [];
  let cursor = null;
  let page = 0;

  do {
    page++;
    const cursorArg = cursor ? `, cursor: "${cursor}"` : '';
    const data = await mondayQuery(`{
      boards(ids: ${boardId}) {
        items_page(limit: 500${cursorArg}) {
          cursor
          items {
            id
            name
            group { id }
            column_values { id text }
          }
        }
      }
    }`);

    const itemsPage = data.data?.boards?.[0]?.items_page;
    if (!itemsPage) break;

    const items = itemsPage.items || [];
    allItems.push(...items);
    cursor = itemsPage.cursor || null;

    console.log(`  Page ${page}: +${items.length} items (total: ${allItems.length})`);
    if (page > 50) { console.log('⚠️ Pagination stoppée à 50 pages'); break; }

  } while (cursor);

  return allItems;
}

async function createItem(boardId, groupId, name, cv) {
  const s = JSON.stringify(JSON.stringify(cv));
  return mondayQuery(`mutation {
    create_item(board_id: ${boardId}, group_id: "${groupId}",
    item_name: "${name.replace(/"/g,'')}",
    column_values: ${s}) { id }
  }`);
}

async function updateItem(boardId, itemId, cv) {
  const s = JSON.stringify(JSON.stringify(cv));
  return mondayQuery(`mutation {
    change_multiple_column_values(board_id: ${boardId},
    item_id: ${itemId}, column_values: ${s}) { id }
  }`);
}

// ─────────────────────────────────────────────────────────────
// FIX v8: moveItem — déplace un item vers un autre groupe
// Appelé quand l'état d'un contrat change (Projet ↔ EN COURS)
// ─────────────────────────────────────────────────────────────
async function moveItem(boardId, itemId, groupId) {
  return mondayQuery(`mutation {
    move_item_to_group(item_id: ${itemId}, group_id: "${groupId}") { id }
  }`);
}

function buildCV(contract) {
  const cv = {};
  const set    = (col, val) => { if (val?.toString().trim()) cv[col] = val.toString().trim(); };
  const setNum = (col, val) => {
    const n = parseFloat(String(val||'').replace(/[^\d.]/g,''));
    if (!isNaN(n) && n > 0) cv[col] = n;
  };
  const setDate = (col, val) => {
    if (!val || val === '---' || val === '-') return;
    const p = String(val).split('/');
    if (p.length === 3) cv[col] = { date: `${p[2]}-${p[1]}-${p[0]}` };
  };

  set(COL.ref,         contract.ref);
  set(COL.type,        contract.type);
  set(COL.cin,         contract.cin);
  setDate(COL.date_sig, contract.date_sig);
  setDate(COL.date_fin, contract.date_fin);
  set(COL.agence,      contract.agence);
  set(COL.nom_entrep,  contract.nom_entrep);
  set(COL.secteur,     contract.secteur);
  set(COL.adresse,     contract.adresse);
  set(COL.rc,          contract.rc);
  set(COL.cnss_empl,   contract.cnss_empl);
  set(COL.forme_jur,   contract.forme_jur);
  set(COL.nom_agent,   contract.nom_agent);
  set(COL.prenom,      contract.prenom);
  set(COL.nationalite, contract.nationalite);
  set(COL.cnss_agent,  contract.cnss_agent);
  set(COL.niveau,      contract.niveau);
  set(COL.poste,       contract.poste);
  setNum(COL.duree,    contract.duree);
  setNum(COL.salaire,  contract.salaire);

  if (contract.telephone) {
    const tel = String(contract.telephone).replace(/[^\d]/g,'').substring(0,10);
    if (tel.length >= 9) cv[COL.telephone] = { phone: tel, countryShortName: 'MA' };
  }

  if (contract.etat?.trim()) {
    cv[COL.etat] = contract.etat.trim();
  }

  return cv;
}

export const handler = async (event) => {
  console.log('=== Lambda ANAPEC → Monday v8 (move_item_to_group) ===');
  try {
    let body;
    if (event.body) {
      body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
    } else {
      body = event;
    }

    const contracts = body.contracts || [];
    const societe   = body.societe   || 'GRUPO_TEYEZ';
    console.log(`Société: ${societe} | ${contracts.length} contrats`);

    if (contracts.length === 0) {
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ message: 'Aucun contrat', stats: { total: 0 } })
      };
    }

    const boardId = BOARD_MAP[societe];
    if (!boardId) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: `Société inconnue: ${societe}` })
      };
    }

    console.log(`Board: ${boardId}`);

    // Charger TOUS les items avec leur groupe actuel
    const items = await getAllMondayItems(boardId);

    // Maps de lookup: ref → { id, currentGroup }
    const itemByRef  = {};
    const itemByName = {};

    items.forEach(item => {
      const currentGroup = item.group?.id || '';
      const entry = { id: item.id, group: currentGroup };

      itemByName[item.name] = entry;
      itemByName[item.name.replace('/1','').replace('/','-')] = entry;

      const refCol = item.column_values.find(c => c.id === COL.ref);
      if (refCol?.text) {
        const r = refCol.text;
        itemByRef[r] = entry;
        itemByRef[r.replace(/^A/,'')] = entry;
        if (r.startsWith('NO')) itemByRef[r.slice(2)] = entry;
      }
    });

    console.log(`${items.length} items chargés (toutes pages)`);
    let created = 0, updated = 0, moved = 0, errors = 0;

    for (const contract of contracts) {
      const ref      = contract.ref || '';
      const etatLow  = (contract.etat || '').toLowerCase();
      const isProjet = etatLow.includes('projet') || etatLow.includes('en cours') || etatLow.includes('cours');
      const targetGroup = isProjet ? GROUP_PROJET : GROUP_EN_COURS;
      const cv = buildCV(contract);

      const existing =
        itemByRef[ref] ||
        itemByRef[ref.replace(/^A/,'')] ||
        itemByName[ref] ||
        itemByName[ref.replace(/\//g,'-')] ||
        null;

      try {
        if (existing) {
          // ── FIX v8: vérifier si le groupe a changé ──
          // Ex: contrat était Projet → maintenant Validé & Signé
          // → déplacer physiquement vers EN COURS
          if (existing.group && existing.group !== targetGroup) {
            console.log(`  ↕ ${ref}: groupe ${existing.group} → ${targetGroup}`);
            await moveItem(boardId, existing.id, targetGroup);
            moved++;
            await new Promise(r => setTimeout(r, 200));
          }

          // Mettre à jour les données
          await updateItem(boardId, existing.id, cv);
          updated++;

        } else {
          // Nouveau contrat → créer dans le bon groupe
          const result = await createItem(boardId, targetGroup, ref, cv);
          const newId = result?.data?.create_item?.id;
          if (newId) {
            itemByRef[ref] = { id: newId, group: targetGroup };
            itemByName[ref] = { id: newId, group: targetGroup };
          }
          created++;
        }
        await new Promise(r => setTimeout(r, 300));
      } catch(e) {
        console.log(`✗ ${ref}: ${e.message}`);
        errors++;
      }
    }

    const stats = { total: contracts.length, created, updated, moved, errors, societe };
    console.log(`=== FIN: ${JSON.stringify(stats)} ===`);
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ message: 'OK', stats })
    };

  } catch(error) {
    console.error('Erreur:', error);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: error.message })
    };
  }
};
