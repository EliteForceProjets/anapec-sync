process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
import { readFileSync, writeFileSync } from 'fs';

const MONDAY_API_KEY = 'eyJhbGciOiJIUzI1NiJ9.eyJ0aWQiOjQ0MjgwOTc1MCwiYWFpIjoxMSwidWlkIjo0MDc5NzY3NywiaWFkIjoiMjAyNC0xMS0yOVQyMDo0MzozNS4wMDBaIiwicGVyIjoibWU6d3JpdGUiLCJhY3RpZCI6MTU1OTc4MTUsInJnbiI6ImV1YzEifQ.kDaFO4cuWLy4Q4PbCe7mLuAGvbRRZAshbvuRG-b3b6U';
const BOARD_ID = '5094200598';

// Charger les contrats de base
const contracts = JSON.parse(readFileSync('C:\\anapec\\contrats.json', 'utf8'));

// Parser le HTML d'un contrat individuel
function parseContractDetail(html) {
  const get = (pattern) => {
    const m = html.match(pattern);
    return m ? m[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim() : '';
  };

  // Extraire toutes les paires label:valeur du contrat
  const data = {};
  
  // Méthode: chercher les balises td consécutives (label | valeur)
  const rows = html.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) || [];
  rows.forEach(row => {
    const tds = row.match(/<td[^>]*>([\s\S]*?)<\/td>/gi) || [];
    if (tds.length >= 2) {
      const label = tds[0].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().replace(/:$/, '');
      const value = tds[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
      if (label && value && label.length < 60) {
        data[label] = value;
      }
    }
  });

  // Chercher aussi dans les spans et divs avec patterns spécifiques
  const nomAgent = get(/[Nn]om.*?[Pp]r[eé]nom[\s\S]{0,200}?<[^>]+>([A-Z][a-zÀ-ÿ]+\s+[A-Z][a-zÀ-ÿ]+)/);
  const cin = get(/CIN[\s\S]{0,100}?[>:]\s*([A-Z]{1,2}\d{4,8})/);
  const cnss = get(/[Nn][°ºo]\s*[Cc][Nn][Ss][Ss][\s\S]{0,100}?[>:]\s*(\d{6,12})/);
  const poste = get(/[Pp]oste[\s\S]{0,100}?[>:]\s*([^\n<]{3,50})/);
  const salaire = get(/[Ss]alaire[\s\S]{0,100}?[>:]\s*([\d\s.,]+)/);
  const duree = get(/[Dd]ur[eé]e[\s\S]{0,100}?[>:]\s*(\d+)/);
  const agence = get(/[Aa]gence[\s\S]{0,100}?[>:]\s*([A-Z][^\n<]{3,50})/);
  
  return { ...data, nomAgent, cin, cnss, poste, salaire, duree, agence };
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

async function getBoard() {
  const data = await mondayQuery(`{
    boards(ids: ${BOARD_ID}) {
      columns { id title type }
      groups { id title }
    }
  }`);
  return data.data?.boards?.[0];
}

async function createItem(groupId, itemName, columnValues) {
  const colValStr = JSON.stringify(JSON.stringify(columnValues));
  const query = `mutation {
    create_item(
      board_id: ${BOARD_ID},
      group_id: "${groupId}",
      item_name: "${itemName.replace(/"/g, '')}",
      column_values: ${colValStr}
    ) { id }
  }`;
  return mondayQuery(query);
}

// Mapper état ANAPEC → statut Monday
function mapEtat(etat) {
  if (!etat) return { index: 0 };
  const e = etat.toLowerCase();
  if (e.includes('validé') || e.includes('signé') || e.includes('signe')) return { index: 1 }; // Fait
  if (e.includes('projet')) return { index: 0 }; // En cours
  if (e.includes('bloqué') || e.includes('annulé')) return { index: 2 }; // Bloqué
  return { index: 0 };
}

async function main() {
  console.log('=== Récupération structure Monday ===');
  const board = await getBoard();
  
  console.log('Colonnes:');
  board.columns.forEach(c => console.log(`  "${c.title}" → id: ${c.id} (${c.type})`));
  
  console.log('\nGroupes:');
  board.groups.forEach(g => console.log(`  "${g.title}" → id: ${g.id}`));

  const colMap = {};
  board.columns.forEach(c => { colMap[c.title] = { id: c.id, type: c.type }; });
  
  const groupEnCours = board.groups.find(g => g.title.toLowerCase().includes('cours')) || board.groups[0];
  const groupProjet = board.groups.find(g => g.title.toLowerCase().includes('projet')) || board.groups[1] || board.groups[0];

  console.log(`\n=== Envoi de ${contracts.length} contrats ===\n`);
  let success = 0, errors = 0;

  for (const contract of contracts) {
    const isProjet = (contract.etat || '').toLowerCase().includes('projet');
    const groupId = isProjet ? groupProjet.id : groupEnCours.id;

    const columnValues = {};

    // Helper pour ajouter une colonne si elle existe
    const addCol = (name, value) => {
      if (colMap[name] && value) {
        const { id, type } = colMap[name];
        if (type === 'color') {
          columnValues[id] = mapEtat(value);
        } else if (type === 'date') {
          const parts = value.split('/');
          if (parts.length === 3 && parts[2].length === 4) {
            columnValues[id] = { date: `${parts[2]}-${parts[1]}-${parts[0]}` };
          }
        } else {
          columnValues[id] = value;
        }
      }
    };

    addCol('N° contrat ANAP', contract.ref);
    addCol('Etat ANAPEC', contract.etat);
    addCol('Type contrat', contract.type);
    addCol('CIN', contract.cin);
    addCol('Date signature', contract.date_sig);
    addCol('Date fin', contract.date_fin);
    
    // Traitement CNSS
    if (colMap['Traitement CNSS']) {
      const cnssVal = contract.cnss || 'Non renseigné';
      columnValues[colMap['Traitement CNSS'].id] = cnssVal.includes('Non') ? { index: 2 } : { index: 1 };
    }

    const itemName = contract.ref || `Contrat-${Date.now()}`;
    
    try {
      const result = await createItem(groupId, itemName, columnValues);
      if (result.data?.create_item?.id) {
        console.log(`✓ ${itemName} (${contract.etat}) → Monday ID: ${result.data.create_item.id}`);
        success++;
      } else {
        const errMsg = result.errors?.[0]?.message || JSON.stringify(result);
        console.log(`✗ ${itemName}: ${errMsg}`);
        errors++;
      }
    } catch (e) {
      console.log(`✗ ${itemName}: ${e.message}`);
      errors++;
    }
    
    await new Promise(r => setTimeout(r, 300));
  }

  console.log(`\n=== RÉSULTAT ===`);
  console.log(`✓ ${success} contrats envoyés`);
  console.log(`✗ ${errors} erreurs`);
}

main().catch(console.error);
