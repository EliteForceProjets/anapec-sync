import { readFileSync } from 'fs';

const MONDAY_API_KEY = 'eyJhbGciOiJIUzI1NiJ9.eyJ0aWQiOjQ0MjgwOTc1MCwiYWFpIjoxMSwidWlkIjo0MDc5NzY3NywiaWFkIjoiMjAyNC0xMS0yOVQyMDo0MzozNS4wMDBaIiwicGVyIjoibWU6d3JpdGUiLCJhY3RpZCI6MTU1OTc4MTUsInJnbiI6ImV1YzEifQ.kDaFO4cuWLy4Q4PbCe7mLuAGvbRRZAshbvuRG-b3b6U';
const BOARD_ID = '5094200598';

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
  // 1. Récupérer les settings des colonnes status
  const data = await mondayQuery(`{
    boards(ids: ${BOARD_ID}) {
      columns { id title type settings_str }
      groups { id title }
    }
  }`);

  const board = data.data.boards[0];
  const colMap = {};
  board.columns.forEach(c => { colMap[c.title] = { id: c.id, type: c.type }; });

  // Afficher les labels disponibles pour chaque colonne status
  console.log('=== LABELS DES COLONNES STATUS ===');
  board.columns.filter(c => c.type === 'color' || c.type === 'status').forEach(c => {
    const settings = JSON.parse(c.settings_str || '{}');
    const labels = settings.labels || {};
    console.log(`\nColonne: "${c.title}" (id: ${c.id})`);
    Object.entries(labels).forEach(([idx, label]) => {
      console.log(`  ${idx}: "${label}"`);
    });
  });

  const groupEnCours = board.groups.find(g => g.title.includes('COURS') || g.title.includes('cours'));
  const groupProjet = board.groups.find(g => g.title.includes('PROJET') || g.title.includes('projet'));

  console.log(`\nGroupe EN COURS: ${groupEnCours?.id}`);
  console.log(`Groupe PROJET: ${groupProjet?.id}`);

  // 2. Envoyer les contrats SANS les colonnes status
  console.log(`\n=== Envoi de ${contracts.length} contrats (sans status) ===`);
  let success = 0, errors = 0;

  for (const contract of contracts) {
    const isProjet = (contract.etat || '').toLowerCase().includes('projet');
    const groupId = isProjet ? (groupProjet?.id || 'group_title') : (groupEnCours?.id || 'topics');

    const columnValues = {};

    // Colonnes texte simples
    if (colMap['N° contrat ANAPEC']) columnValues[colMap['N° contrat ANAPEC'].id] = contract.ref || '';
    if (colMap['Type contrat']) columnValues[colMap['Type contrat'].id] = contract.type || '';
    if (colMap['CIN']) columnValues[colMap['CIN'].id] = contract.cin || '';

    // Dates
    const formatDate = (d) => {
      if (!d || d === '---') return null;
      const parts = d.split('/');
      if (parts.length === 3) return `${parts[2]}-${parts[1]}-${parts[0]}`;
      return null;
    };
    const dateSig = formatDate(contract.date_sig);
    const dateFin = formatDate(contract.date_fin);
    if (dateSig && colMap['Date signature']) columnValues[colMap['Date signature'].id] = { date: dateSig };
    if (dateFin && colMap['Date fin']) columnValues[colMap['Date fin'].id] = { date: dateFin };

    const itemName = (contract.ref || 'Contrat').replace(/["/\\]/g, '');
    const colValStr = JSON.stringify(JSON.stringify(columnValues));

    const query = `mutation {
      create_item(
        board_id: ${BOARD_ID},
        group_id: "${groupId}",
        item_name: "${itemName}",
        column_values: ${colValStr}
      ) { id }
    }`;

    try {
      const result = await mondayQuery(query);
      if (result.data?.create_item?.id) {
        console.log(`✓ ${itemName} → ID: ${result.data.create_item.id}`);
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

  console.log(`\n✓ ${success} succès / ✗ ${errors} erreurs`);
}

main().catch(console.error);
