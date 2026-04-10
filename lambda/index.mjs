// Lambda reçoit les données depuis votre PC et les envoie vers Monday.com
import https from 'https';

const MONDAY_API_KEY = process.env.MONDAY_API_KEY;
const BOARD_ID = process.env.MONDAY_BOARD_ID;

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
  const result = await mondayQuery(`mutation {
    create_item(
      board_id: ${BOARD_ID},
      group_id: "${groupId}",
      item_name: "${name.replace(/"/g,'')}",
      column_values: ${s}
    ) { id }
  }`);
  return result;
}

async function updateItem(itemId, cv) {
  const s = JSON.stringify(JSON.stringify(cv));
  return mondayQuery(`mutation {
    change_multiple_column_values(
      board_id: ${BOARD_ID},
      item_id: ${itemId},
      column_values: ${s}
    ) { id }
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
  else if (etat.includes('projet')) cv[COL.etat] = { index: 0 };
  else cv[COL.etat] = { index: 0 };

  return cv;
}

export const handler = async (event) => {
  console.log('=== Lambda ANAPEC → Monday reçu ===');

  try {
    // Parser le body reçu depuis le PC
    let contracts = [];
    
    if (event.body) {
      // Appel HTTP via URL de fonction
      const body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
      contracts = body.contracts || [];
    } else if (event.contracts) {
      // Appel direct (test)
      contracts = event.contracts;
    } else if (Array.isArray(event)) {
      contracts = event;
    }

    console.log(`${contracts.length} contrats reçus`);

    if (contracts.length === 0) {
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'Aucun contrat reçu', stats: { total: 0 } })
      };
    }

    // Récupérer items Monday existants
    const items = await getMondayItems();
    const itemByRef = {};
    const itemByName = {};
    items.forEach(item => {
      itemByName[item.name] = item.id;
      const refCol = item.column_values.find(c => c.id === COL.ref);
      if (refCol?.text) itemByRef[refCol.text] = item.id;
    });

    console.log(`${items.length} items existants dans Monday`);

    let created = 0, updated = 0, errors = 0;

    for (const contract of contracts) {
      const ref = contract.ref || '';
      const isProjet = (contract.etat || '').toLowerCase().includes('projet');
      const groupId = isProjet ? 'group_title' : 'topics';
      const cv = buildCV(contract);

      // Chercher item existant
      const existingId = itemByRef[ref] || itemByName[ref];

      try {
        if (existingId) {
          await updateItem(existingId, cv);
          console.log(`↻ Mis à jour: ${ref}`);
          updated++;
        } else {
          await createItem(groupId, ref, cv);
          console.log(`+ Créé: ${ref}`);
          created++;
        }
        await new Promise(r => setTimeout(r, 300));
      } catch(e) {
        console.log(`✗ Erreur ${ref}: ${e.message}`);
        errors++;
      }
    }

    const stats = { total: contracts.length, created, updated, errors };
    console.log(`=== FIN: ${JSON.stringify(stats)} ===`);

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ message: 'Synchronisation terminée', stats, date: new Date().toISOString() })
    };

  } catch(error) {
    console.error('Erreur:', error.message);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: error.message })
    };
  }
};
