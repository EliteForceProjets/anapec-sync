import { writeFileSync } from 'fs';

const MONDAY_API_KEY = 'eyJhbGciOiJIUzI1NiJ9.eyJ0aWQiOjQ0MjgwOTc1MCwiYWFpIjoxMSwidWlkIjo0MDc5NzY3NywiaWFkIjoiMjAyNC0xMS0yOVQyMDo0MzozNS4wMDBaIiwicGVyIjoibWU6d3JpdGUiLCJhY3RpZCI6MTU1OTc4MTUsInJnbiI6ImV1YzEifQ.kDaFO4cuWLy4Q4PbCe7mLuAGvbRRZAshbvuRG-b3b6U';
const BOARD_ID = '5094200598';

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
  console.log('=== Sauvegarde du board Monday ===');

  const data = await mondayQuery(`{
    boards(ids: ${BOARD_ID}) {
      name
      columns { id title type }
      groups { id title }
      items_page(limit: 100) {
        items {
          id
          name
          group { id title }
          column_values { id title text value }
        }
      }
    }
  }`);

  const board = data.data?.boards?.[0];
  const items = board?.items_page?.items || [];

  console.log(`Board: ${board?.name}`);
  console.log(`Items: ${items.length}`);

  // Sauvegarder en JSON complet
  const backup = {
    date: new Date().toISOString(),
    board_name: board?.name,
    board_id: BOARD_ID,
    columns: board?.columns,
    groups: board?.groups,
    items: items
  };

  const filename = `C:\\anapec\\monday_backup_${new Date().toISOString().replace(/[:.]/g,'-').substring(0,19)}.json`;
  writeFileSync(filename, JSON.stringify(backup, null, 2));
  console.log(`✓ Sauvegarde: ${filename}`);

  // Afficher résumé
  console.log('\n=== Résumé ===');
  items.forEach(item => {
    const cols = {};
    item.column_values.forEach(c => { if(c.text) cols[c.title] = c.text; });
    console.log(`${item.group.title} | ${item.name} | ${cols['Etat ANAPEC']||''} | ${cols['CIN']||''}`);
  });
}

main().catch(console.error);
