process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
import { readFileSync, writeFileSync } from 'fs';

const MONDAY_API_KEY = 'eyJhbGciOiJIUzI1NiJ9.eyJ0aWQiOjQ0MjgwOTc1MCwiYWFpIjoxMSwidWlkIjo0MDc5NzY3NywiaWFkIjoiMjAyNC0xMS0yOVQyMDo0MzozNS4wMDBaIiwicGVyIjoibWU6d3JpdGUiLCJhY3RpZCI6MTU1OTc4MTUsInJnbiI6ImV1YzEifQ.kDaFO4cuWLy4Q4PbCe7mLuAGvbRRZAshbvuRG-b3b6U';
const BOARD_ID = '5094200598';
const SESSION_COOKIE = 'CAKEPHP=0iq3k45ofevhm808dtah0ukq20; CakeCookie[Employeur]=Q2FrZQ%3D%3D.A3ZdNf2tpnDA3jzixaP3LMqsF7zgxIzkiC9i0z9bLjj%2BiZ8ZeCPrZThulAD5bDve';

// IDs des contrats trouvés
const CONTRACT_IDS = [1567973, 1567961, 1566826, 1564903, 1564768, 1564759, 1564737, 1564323, 1564313, 1563863];

// Colonnes Monday
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
  cnss_trait: 'color_mm253wpv',
  email:      'text_mm25cb1c'
};

function getText(html, label) {
  // Chercher dans les tableaux : label | valeur
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const patterns = [
    new RegExp(escaped + '[\\s\\S]{0,50}?<\\/td>[\\s\\S]{0,20}?<td[^>]*>([^<]{1,200})', 'i'),
    new RegExp('<td[^>]*>[\\s\\S]{0,5}' + escaped + '[\\s\\S]{0,5}<\\/td>[\\s\\S]{0,20}<td[^>]*>([^<]{1,200})', 'i'),
  ];
  for (const p of patterns) {
    const m = html.match(p);
    if (m) return m[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
  }
  return '';
}

function parseContract(html) {
  // Extraire toutes les paires label=>valeur
  const data = {};
  const trMatches = html.match(/<tr[^>]*>([\s\S]*?)<\/tr>/gi) || [];
  
  trMatches.forEach(tr => {
    const tds = tr.match(/<td[^>]*>([\s\S]*?)<\/td>/gi) || [];
    if (tds.length >= 2) {
      const label = tds[0].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().replace(/:?\s*$/, '');
      const value = tds[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
      if (label && value && label.length < 80) {
        data[label] = value;
      }
    }
  });
  
  return data;
}

async function fetchContrat(id) {
  const url = `https://anapec.org/sigec-app-rv/fr/entreprises/edition_ci/${id}`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Cookie': SESSION_COOKIE,
      'Accept': 'text/html',
    }
  });
  return res.text();
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
      items_page(limit: 50) {
        items { 
          id 
          name
          column_values { id text value }
        }
      }
    }
  }`);
  return data.data?.boards?.[0]?.items_page?.items || [];
}

async function updateItem(itemId, columnValues) {
  const colValStr = JSON.stringify(JSON.stringify(columnValues));
  const query = `mutation {
    change_multiple_column_values(
      board_id: ${BOARD_ID},
      item_id: ${itemId},
      column_values: ${colValStr}
    ) { id }
  }`;
  return mondayQuery(query);
}

async function main() {
  console.log('=== Récupération des items Monday ===');
  const items = await getMondayItems();
  console.log(`${items.length} items dans Monday`);
  
  // Map: N° contrat ANAPEC → item Monday
  const itemMap = {};
  items.forEach(item => {
    // Chercher la colonne N° contrat ANAPEC
    const refCol = item.column_values.find(c => c.id === COL.ref);
    const refVal = refCol?.text || '';
    if (refVal) itemMap[refVal] = item.id;
    // Aussi par nom
    itemMap[item.name] = item.id;
  });

  console.log('\n=== Scraping des contrats ANAPEC ===');
  const allDetails = [];

  for (const contractId of CONTRACT_IDS) {
    console.log(`\nScraping contrat ID: ${contractId}`);
    try {
      const html = await fetchContrat(contractId);
      
      if (html.includes('login') || html.includes('connexion') || html.length < 5000) {
        console.log(`  ⚠ Session expirée ou page trop courte (${html.length} chars)`);
        // Sauvegarder depuis fichier local si disponible
        continue;
      }

      const data = parseContract(html);
      console.log(`  Champs extraits: ${Object.keys(data).length}`);
      Object.entries(data).slice(0, 10).forEach(([k,v]) => console.log(`    ${k}: ${v}`));
      
      allDetails.push({ contractId, data });
    } catch(e) {
      console.log(`  Erreur: ${e.message}`);
    }
    await new Promise(r => setTimeout(r, 500));
  }

  // Sauvegarder les détails
  writeFileSync('C:\\anapec\\contracts_details.json', JSON.stringify(allDetails, null, 2));
  console.log(`\n${allDetails.length} contrats détaillés sauvegardés`);

  if (allDetails.length === 0) {
    console.log('\n⚠ Aucune donnée — la session a probablement expiré.');
    console.log('Récupérez un nouveau cookie CAKEPHP depuis le navigateur !');
    return;
  }

  console.log('\n=== Mise à jour Monday ===');
  let success = 0;

  for (const { contractId, data } of allDetails) {
    // Trouver le ref contrat dans les données
    const refContrat = data['الاتفاقية رقم'] || data['Ref contrat'] || data['N° contrat'] || '';
    const itemId = itemMap[refContrat] || Object.values(itemMap)[allDetails.indexOf({contractId, data})];
    
    if (!itemId) {
      console.log(`⚠ Item non trouvé pour contrat ${contractId}`);
      continue;
    }

    // Construire les valeurs
    const cv = {};
    
    const setTxt = (col, val) => { if (val) cv[col] = val; };
    const setNum = (col, val) => { 
      const n = parseFloat(val?.replace(/[^\d.]/g, ''));
      if (!isNaN(n)) cv[col] = n;
    };
    const setDate = (col, val) => {
      if (!val || val === '---') return;
      const parts = val.split('/');
      if (parts.length === 3) cv[col] = { date: `${parts[2]}-${parts[1]}-${parts[0]}` };
    };

    // Mapper les champs arabes et français
    setTxt(COL.nom_entrep, data['الاسم التجاري'] || data['Nom entreprise'] || data['GRUPO TEYEZ']);
    setTxt(COL.rc, data['رقم القيد في السجل التجاري'] || data['RC']);
    setTxt(COL.cnss_empl, data['رقم الانخراط في الصندوق الوطني للضمان الاجتماعي'] || data['CNSS employeur']);
    setTxt(COL.adresse, data['العنوان'] || data['Adresse']);
    setTxt(COL.telephone, data['الهاتف'] || data['Téléphone']);
    setTxt(COL.forme_jur, data['النظام القانوني'] || data['Forme juridique']);
    
    setTxt(COL.nom_agent, data['الاسم العائلي'] || data['Nom']);
    setTxt(COL.prenom, data['الاسم الشخصي'] || data['Prénom']);
    setTxt(COL.nationalite, data['الجنسية'] || data['Nationalité']);
    setTxt(COL.cin, data['رقم بطاقة التعريف الوطنية'] || data['CIN']);
    setTxt(COL.cnss_agent, data['رقم التسجيل بالصندوق الوطني للضمان الاجتماعي'] || data['N° CNSS']);
    setTxt(COL.niveau, data['المستوى التعليمي'] || data['Niveau scolaire']);
    setTxt(COL.poste, data['المهنة'] || data['Poste']);
    setNum(COL.duree, data['المدة'] || data['Durée']);
    setNum(COL.salaire, data['الأجر'] || data['Salaire']);
    setTxt(COL.agence, data['الوكالة'] || data['Agence']);
    setTxt(COL.secteur, data['قطاع النشاط'] || data['Secteur']);

    if (Object.keys(cv).length > 0) {
      const result = await updateItem(itemId, cv);
      if (result.data?.change_multiple_column_values?.id) {
        console.log(`✓ Contrat ${contractId} mis à jour (${Object.keys(cv).length} champs)`);
        success++;
      } else {
        console.log(`✗ Contrat ${contractId}: ${result.errors?.[0]?.message}`);
      }
    }
    await new Promise(r => setTimeout(r, 300));
  }

  console.log(`\n✓ ${success} contrats mis à jour dans Monday !`);
}

main().catch(console.error);
