import { readFileSync, readdirSync } from 'fs';

const MONDAY_API_KEY = 'eyJhbGciOiJIUzI1NiJ9.eyJ0aWQiOjQ0MjgwOTc1MCwiYWFpIjoxMSwidWlkIjo0MDc5NzY3NywiaWFkIjoiMjAyNC0xMS0yOVQyMDo0MzozNS4wMDBaIiwicGVyIjoibWU6d3JpdGUiLCJhY3RpZCI6MTU1OTc4MTUsInJnbiI6ImV1YzEifQ.kDaFO4cuWLy4Q4PbCe7mLuAGvbRRZAshbvuRG-b3b6U';
const BOARD_ID = '5094200598';

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

function parseContractHTML(html) {
  const data = {};
  
  // Extraire toutes les paires TR > TD label | valeur
  const trPattern = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let m;
  while ((m = trPattern.exec(html)) !== null) {
    const tds = m[1].match(/<td[^>]*>([\s\S]*?)<\/td>/gi) || [];
    if (tds.length >= 2) {
      const label = tds[0].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().replace(/:?\s*$/, '');
      const value = tds[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
      if (label && value && label.length < 100 && value.length < 200) {
        data[label] = value;
      }
    }
  }

  // Chercher aussi dans les spans/divs pour les champs spécifiques
  const getField = (patterns) => {
    for (const p of patterns) {
      const match = html.match(p);
      if (match) return match[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    }
    return '';
  };

  // Numéro de contrat
  data._ref = getField([
    /[Aa]ttefaqiya[^<]*<[^>]+>([AI]\d+\/\d+)/,
    /الاتفاقية رقم[\s\S]{0,100}([AI]\d+[\/\d]+)/,
    /Accord[^<]*<[^>]+>([AI]\d+[\/\d]+)/
  ]) || Object.values(data).find(v => /^AI\d+\/\d+$/.test(v)) || '';

  return data;
}

function findValue(data, keys) {
  for (const key of keys) {
    for (const [k, v] of Object.entries(data)) {
      if (k.toLowerCase().includes(key.toLowerCase()) || 
          k.includes(key)) {
        if (v && v !== '---' && v.length > 0) return v;
      }
    }
  }
  return '';
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
          id name
          column_values { id text }
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
  // 1. Lire tous les fichiers ci_*.html
  const files = readdirSync('C:\\anapec\\').filter(f => f.startsWith('ci_') && f.endsWith('.html'));
  console.log(`=== ${files.length} fichiers contrats trouvés ===`);
  files.forEach(f => console.log('  ' + f));

  if (files.length === 0) {
    console.log('Aucun fichier ci_*.html trouvé dans C:\\anapec\\');
    return;
  }

  // 2. Récupérer items Monday
  console.log('\n=== Récupération items Monday ===');
  const items = await getMondayItems();
  console.log(`${items.length} items trouvés`);

  // Map par nom et par N° contrat
  const itemByName = {};
  const itemByRef = {};
  items.forEach(item => {
    itemByName[item.name] = item.id;
    const refCol = item.column_values.find(c => c.id === COL.ref);
    if (refCol?.text) itemByRef[refCol.text] = item.id;
  });

  // 3. Parser chaque fichier
  let success = 0, errors = 0;

  for (const file of files) {
    const contractId = file.replace('ci_', '').replace('.html', '').replace(/\s.*/, '');
    console.log(`\n--- Parsing ${file} ---`);
    
    const html = readFileSync(`C:\\anapec\\${file}`, 'utf8');
    const data = parseContractHTML(html);
    
    console.log(`  Champs extraits: ${Object.keys(data).length}`);
    // Afficher tous les champs pour debug
    Object.entries(data).forEach(([k, v]) => {
      if (!k.startsWith('_')) console.log(`    "${k}" => "${v}"`);
    });

    // Trouver le numéro de contrat ANAPEC dans les données
    const refContrat = data._ref || 
      findValue(data, ['الاتفاقية', 'Accord', 'contrat', 'AI']) ||
      Object.values(data).find(v => /^[AI]\d{10,}\/\d+/.test(v)) || '';
    
    console.log(`  Ref contrat trouvé: "${refContrat}"`);

    // Trouver l'item Monday correspondant
    let itemId = itemByRef[refContrat] || itemByName[refContrat];
    
    if (!itemId) {
      // Essayer de matcher par partie du nom
      for (const [name, id] of Object.entries(itemByName)) {
        if (refContrat && name.includes(refContrat.split('/')[0])) {
          itemId = id;
          break;
        }
      }
    }

    if (!itemId) {
      console.log(`  ⚠ Item Monday non trouvé pour ref: "${refContrat}"`);
      console.log(`  Items disponibles: ${Object.keys(itemByName).slice(0,5).join(', ')}`);
      errors++;
      continue;
    }

    console.log(`  ✓ Item Monday trouvé: ${itemId}`);

    // Construire les valeurs colonnes
    const cv = {};
    const set = (col, val) => { if (val && val.trim()) cv[col] = val.trim(); };
    const setNum = (col, val) => {
      const n = parseFloat((val || '').replace(/[^\d.,]/g, '').replace(',', '.'));
      if (!isNaN(n) && n > 0) cv[col] = n;
    };

    // Entreprise
    set(COL.nom_entrep, findValue(data, ['الاسم التجاري', 'GRUPO', 'entreprise', 'Nom entreprise', 'raison']));
    set(COL.rc, findValue(data, ['السجل التجاري', 'RC', 'registre']));
    set(COL.cnss_empl, findValue(data, ['الانخراط', 'CNSS employeur', 'cnss empl']));
    set(COL.adresse, findValue(data, ['العنوان', 'Adresse', 'adresse']));
    set(COL.telephone, findValue(data, ['الهاتف', 'Téléphone', 'GSM', 'Tel', 'tél']));
    set(COL.forme_jur, findValue(data, ['النظام القانوني', 'Forme juridique', 'juridique']));
    set(COL.email, findValue(data, ['البريد', 'Email', 'email', 'mail']));
    set(COL.secteur, findValue(data, ['قطاع', 'Secteur', 'secteur activité']));
    
    // Agent/Stagiaire
    set(COL.nom_agent, findValue(data, ['الاسم العائلي', 'Nom agent', 'NOM', 'famille']));
    set(COL.prenom, findValue(data, ['الاسم الشخصي', 'Prénom', 'prenom', 'personnel']));
    set(COL.nationalite, findValue(data, ['الجنسية', 'Nationalité', 'nationalite']));
    set(COL.cin, findValue(data, ['بطاقة التعريف', 'CIN', 'cin', 'carte identité']));
    set(COL.cnss_agent, findValue(data, ['رقم التسجيل', 'N° CNSS', 'cnss agent']));
    set(COL.niveau, findValue(data, ['المستوى التعليمي', 'Niveau scolaire', 'niveau', 'diplôme']));
    set(COL.poste, findValue(data, ['المهنة', 'Poste', 'poste', 'emploi', 'fonction']));
    set(COL.agence, findValue(data, ['الوكالة', 'Agence', 'agence']));
    
    setNum(COL.duree, findValue(data, ['المدة', 'Durée', 'duree', 'mois']));
    setNum(COL.salaire, findValue(data, ['الأجر', 'Salaire', 'salaire', 'rémunération']));

    console.log(`  Colonnes à mettre à jour: ${Object.keys(cv).length}`);
    Object.entries(cv).forEach(([k, v]) => console.log(`    ${k}: ${JSON.stringify(v)}`));

    if (Object.keys(cv).length > 0) {
      try {
        const result = await updateItem(itemId, cv);
        if (result.data?.change_multiple_column_values?.id) {
          console.log(`  ✓ Monday mis à jour !`);
          success++;
        } else {
          console.log(`  ✗ Erreur: ${result.errors?.[0]?.message}`);
          errors++;
        }
      } catch(e) {
        console.log(`  ✗ Exception: ${e.message}`);
        errors++;
      }
    } else {
      console.log(`  ⚠ Aucune colonne à mettre à jour`);
    }

    await new Promise(r => setTimeout(r, 400));
  }

  console.log(`\n=== RÉSULTAT FINAL ===`);
  console.log(`✓ ${success} contrats mis à jour`);
  console.log(`✗ ${errors} erreurs`);
}

main().catch(console.error);
