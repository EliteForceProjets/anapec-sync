// Lambda ANAPEC → Monday.com - Multi-sociétés
import https from 'https';

const MONDAY_API_KEY = process.env.MONDAY_API_KEY;

// Mapping société → board ID
const BOARD_MAP = {
  'GRUPO_TEYEZ':    process.env.MONDAY_BOARD_ID,
  'SIGARMOR':       process.env.BOARD_SIGARMOR,
  'EIM':            process.env.BOARD_EIM,
  'KIRKOS':         process.env.BOARD_KIRKOS,
  'KIRKOS_GUARD':   process.env.BOARD_KIRKOS_GUARD,
  'NEISS':          process.env.BOARD_NEISS,
  'NORIA_BIANCA':   process.env.BOARD_NORIA_BIANCA,
  'CQ_SERVICE':     process.env.BOARD_CQ_SERVICE,
};

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
      res.on('end', () => resolve(JSON.parse(data)));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function getMondayItems(boardId) {
  const data = await mondayQuery(`{
    boards(ids: ${boardId}) {
      items_page(limit: 500) {
        items { id name column_values { id text } }
      }
    }
  }`);
  return data.data?.boards?.[0]?.items_page?.items || [];
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
  if (etat.includes('validé') || etat.includes('signé') || etat.includes('fait')) {
    cv[COL.etat] = { index: 1 };
  } else {
    cv[COL.etat] = { index: 0 };
  }

  return cv;
}

export const handler = async (event) => {
  console.log('=== Lambda ANAPEC → Monday Multi-Sociétés ===');

  try {
    let body;
    if (event.body) {
      body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
    } else {
      body = event;
    }

    const contracts = body.contracts || [];
    const societe = body.societe || 'GRUPO_TEYEZ'; // Société par défaut

    console.log(`Société: ${societe}`);
    console.log(`${contracts.length} contrats reçus`);

    if (contracts.length === 0) {
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ message: 'Aucun contrat reçu', stats: { total: 0 } })
      };
    }

    // Trouver le board ID pour cette société
    const boardId = BOARD_MAP[societe];
    if (!boardId) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: `Société inconnue: ${societe}. Sociétés disponibles: ${Object.keys(BOARD_MAP).join(', ')}` })
      };
    }

    console.log(`Board ID: ${boardId}`);

    // Récupérer items Monday existants
    const items = await getMondayItems(boardId);
    const itemByRef = {};
    const itemByName = {};
    items.forEach(item => {
      itemByName[item.name] = item.id;
      const nameClean = item.name.replace('/1','').replace('/','');
      itemByName[nameClean] = item.id;
      const refCol = item.column_values.find(c => c.id === COL.ref);
      if (refCol?.text) {
        itemByRef[refCol.text] = item.id;
        itemByRef[refCol.text.replace('/1','').replace('/','')] = item.id;
      }
    });

    console.log(`${items.length} items existants dans Monday`);

    let created = 0, updated = 0, errors = 0;

    for (const contract of contracts) {
      const ref = contract.ref || '';
      const isProjet = (contract.etat || '').toLowerCase().includes('projet') ||
                       (contract.etat || '').toLowerCase().includes('cours');
      const groupId = isProjet ? 'group_title' : 'topics';
      const cv = buildCV(contract);
      const existingId = itemByRef[ref] || itemByName[ref];

      try {
        if (existingId) {
          await updateItem(boardId, existingId, cv);
          console.log(`↻ Mis à jour: ${ref}`);
          updated++;
        } else {
          await createItem(boardId, groupId, ref, cv);
          console.log(`+ Créé: ${ref}`);
          created++;
        }
        await new Promise(r => setTimeout(r, 300));
      } catch(e) {
        console.log(`✗ Erreur ${ref}: ${e.message}`);
        errors++;
      }
    }

    const stats = { total: contracts.length, created, updated, errors, societe, boardId };
    console.log(`=== FIN: ${JSON.stringify(stats)} ===`);

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ message: 'Synchronisation terminée', stats, date: new Date().toISOString() })
    };

  } catch(error) {
    console.error('Erreur:', error);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: error.message, stack: error.stack })
    };
  }
};
