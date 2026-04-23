// reset_global.mjs — Vide ANAPEC_GLOBAL puis relance Fusion_TAB
// Usage: node C:\anapec\reset_global.mjs

import { execSync } from 'child_process';

const MONDAY_API_KEY = process.env.MONDAY_API_KEY || 'eyJhbGciOiJIUzI1NiJ9.eyJ0aWQiOjQ2OTkwODkwNSwiYWFpIjoxMSwidWlkIjo3MDU1MDk5NiwiaWFkIjoiMjAyNS0wMS0yM1QxMjowNjoyNy4wMDBaIiwicGVyIjoibWU6d3JpdGUiLCJhY3RpZCI6MjY0MjcxMDMsInJnbiI6ImV1YzEifQ.XCYFs_u0bpnKJL5B1U4S3tBKLHSfqJBjkp4KTGa5vVw';
const BOARD_GLOBAL = '5094534887';

function log(msg) { console.log(`[${new Date().toLocaleTimeString('fr-FR')}] ${msg}`); }

async function gql(query) {
  const res = await fetch('https://api.monday.com/v2', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': MONDAY_API_KEY,
      'API-Version': '2024-01'
    },
    body: JSON.stringify({ query })
  });
  const data = await res.json();
  if (data.errors) throw new Error(JSON.stringify(data.errors));
  return data.data;
}

async function getAllItemIds() {
  let ids = [], cursor = null;
  do {
    const q = cursor
      ? `query { next_items_page(limit: 500, cursor: "${cursor}") { cursor items { id } } }`
      : `query { boards(ids: ${BOARD_GLOBAL}) { items_page(limit: 500) { cursor items { id } } } }`;
    const d = await gql(q);
    const page = cursor ? d.next_items_page : d.boards[0].items_page;
    cursor = page.cursor;
    ids.push(...page.items.map(i => i.id));
    log(`  Chargé: ${ids.length} items...`);
  } while (cursor);
  return ids;
}

async function deleteItem(id) {
  await gql(`mutation { delete_item(item_id: ${id}) { id } }`);
}

async function main() {
  log('🗑️  RESET ANAPEC_GLOBAL — Suppression de tous les items...');
  
  const ids = await getAllItemIds();
  log(`📊 ${ids.length} items à supprimer`);

  let deleted = 0;
  for (const id of ids) {
    try {
      await deleteItem(id);
      deleted++;
      if (deleted % 50 === 0) log(`  ✅ ${deleted}/${ids.length} supprimés...`);
      await new Promise(r => setTimeout(r, 150)); // pause anti-rate-limit
    } catch(e) {
      log(`  ❌ Erreur suppression ID:${id}: ${e.message}`);
    }
  }

  log(`✅ ${deleted}/${ids.length} items supprimés`);
  log('');
  log('🔄 Lancement de Fusion_TAB pour re-remplir GLOBAL...');
  log('');

  try {
    execSync('node C:\\anapec\\Fusion_TAB.mjs', { stdio: 'inherit' });
  } catch(e) {
    log(`❌ Erreur Fusion_TAB: ${e.message}`);
  }
}

main().catch(console.error);
