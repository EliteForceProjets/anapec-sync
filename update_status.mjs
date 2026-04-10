import { readFileSync } from 'fs';

const MONDAY_API_KEY = 'eyJhbGciOiJIUzI1NiJ9.eyJ0aWQiOjQ0MjgwOTc1MCwiYWFpIjoxMSwidWlkIjo0MDc5NzY3NywiaWFkIjoiMjAyNC0xMS0yOVQyMDo0MzozNS4wMDBaIiwicGVyIjoibWU6d3JpdGUiLCJhY3RpZCI6MTU1OTc4MTUsInJnbiI6ImV1YzEifQ.kDaFO4cuWLy4Q4PbCe7mLuAGvbRRZAshbvuRG-b3b6U';
const BOARD_ID = '5094200598';

// Labels Monday disponibles:
// Etat ANAPEC:    0=En cours, 1=Fait, 2=Bloqué
// Traitement CNSS: 0=En cours, 1=Fait, 2=Bloqué

// Mapping ANAPEC → Monday
function mapEtatAnapec(etat) {
  if (!etat) return 0;
  const e = etat.toLowerCase();
  if (e.includes('validé') || e.includes('signé')) return 1; // Fait
  if (e.includes('projet')) return 0;   // En cours
  if (e.includes('bloqué') || e.includes('annulé')) return 2; // Bloqué
  return 0;
}

function mapCnss(cnss) {
  if (!cnss) return 2;
  const c = cnss.toLowerCase();
  if (c.includes('non')) return 2;   // Bloqué
  if (c.includes('oui') || c.includes('fait')) return 1; // Fait
  return 0;
}

const contracts = JSON.parse(readFileSync('C:\\anapec\\contrats.json', 'utf8'));

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

async function main() {
  // Récupérer les items existants du board
  console.log('=== Récupération des items Monday ===');
  const data = await mondayQuery(`{
    boards(ids: ${BOARD_ID}) {
      items_page(limit: 50) {
        items { id name }
      }
    }
  }`);

  const items = data.data?.boards?.[0]?.items_page?.items || [];
  console.log(`${items.length} items trouvés dans Monday`);

  // Créer un map nom → id
  const itemMap = {};
  items.forEach(item => { itemMap[item.name] = item.id; });

  console.log('\n=== Mise à jour des statuts ===');
  let success = 0, errors = 0;

  for (const contract of contracts) {
    const itemName = (contract.ref || '').replace(/["/\\]/g, '');
    const itemId = itemMap[itemName];

    if (!itemId) {
      console.log(`⚠ Item "${itemName}" non trouvé dans Monday`);
      continue;
    }

    const etatIndex = mapEtatAnapec(contract.etat);
    const cnssIndex = mapCnss(contract.cnss);

    const columnValues = {
      'color_mm25jvb9': { index: etatIndex },   // Etat ANAPEC
      'color_mm253wpv': { index: cnssIndex }     // Traitement CNSS
    };

    const colValStr = JSON.stringify(JSON.stringify(columnValues));
    const query = `mutation {
      change_multiple_column_values(
        board_id: ${BOARD_ID},
        item_id: ${itemId},
        column_values: ${colValStr}
      ) { id }
    }`;

    try {
      const result = await mondayQuery(query);
      if (result.data?.change_multiple_column_values?.id) {
        console.log(`✓ ${itemName} → Etat: ${contract.etat} (${etatIndex}) | CNSS: ${contract.cnss} (${cnssIndex})`);
        success++;
      } else {
        console.log(`✗ ${itemName}: ${result.errors?.[0]?.message}`);
        errors++;
      }
    } catch (e) {
      console.log(`✗ ${itemName}: ${e.message}`);
      errors++;
    }

    await new Promise(r => setTimeout(r, 300));
  }

  console.log(`\n✓ ${success} mis à jour / ✗ ${errors} erreurs`);
}

main().catch(console.error);
