// Lambda ANAPEC → Monday.com - Multi-sociétés v7
// FIX DOUBLONS: pagination complète (cursor-based) pour récupérer TOUS les items
// Sans pagination, limit:500 rate les anciens items → doublons créés
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
// FIX v7: récupérer TOUS les items avec pagination cursor-based
// L'ancienne version (limit:500) ratait les boards > 500 items
// → existingId = undefined → doublon créé à chaque run
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
          items { id name column_values { id text } }
        }
      }
    }`);

    const itemsPage = data.data?.boards?.[0]?.items_page;
    if (!itemsPage) break;

    const items = itemsPage.items || [];
    allItems.push(...items);
    cursor = itemsPage.cursor || null;

    console.log(`  Page ${page}: +${items.length} items (total: ${allItems.length}) cursor: ${cursor ? 'oui' : 'fin'}`);

    // Sécurité anti-boucle infinie
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
  console.log('=== Lambda ANAPEC → Monday v7 ===');
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
        body: JSON.stringify({ error: `Société inconnue: ${societe}. Dispo: ${Object.keys(BOARD_MAP).join(', ')}` })
      };
    }

    console.log(`Board: ${boardId}`);

    // FIX v7: pagination complète — récupère TOUS les items sans limite
    const items = await getAllMondayItems(boardId);

    // Construire les maps de lookup (ref → itemId)
    const itemByRef  = {};
    const itemByName = {};
    items.forEach(item => {
      // Par nom de l'item
      itemByName[item.name] = item.id;
      itemByName[item.name.replace('/1','').replace('/','-')] = item.id;

      // Par colonne ref
      const refCol = item.column_values.find(c => c.id === COL.ref);
      if (refCol?.text) {
        itemByRef[refCol.text] = item.id;
        // Variantes sans préfixe et avec tiret
        const r = refCol.text;
        itemByRef[r.replace(/^A/,'')] = item.id;
        if (r.startsWith('NO')) itemByRef[r.slice(2)] = item.id;
      }
    });

    console.log(`${items.length} items chargés (toutes pages)`);
    let created = 0, updated = 0, errors = 0;

    for (const contract of contracts) {
      const ref     = contract.ref || '';
      const etatLow = (contract.etat || '').toLowerCase();
      const isProjet = etatLow.includes('projet') || etatLow.includes('en cours') || etatLow.includes('cours');
      const groupId  = isProjet ? 'group_title' : 'topics';
      const cv = buildCV(contract);

      // Lookup par ref ou par nom (avec variantes)
      const existingId =
        itemByRef[ref] ||
        itemByRef[ref.replace(/^A/,'')] ||
        itemByName[ref] ||
        itemByName[ref.replace(/\//g,'-')] ||
        null;

      try {
        if (existingId) {
          await updateItem(boardId, existingId, cv);
          updated++;
        } else {
          const result = await createItem(boardId, groupId, ref, cv);
          // Enregistrer le nouvel item pour éviter les doublons intra-batch
          const newId = result?.data?.create_item?.id;
          if (newId) {
            itemByRef[ref] = newId;
            itemByName[ref] = newId;
          }
          created++;
        }
        await new Promise(r => setTimeout(r, 300));
      } catch(e) {
        console.log(`✗ ${ref}: ${e.message}`);
        errors++;
      }
    }

    const stats = { total: contracts.length, created, updated, errors, societe };
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
