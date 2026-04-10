import { readFileSync } from 'fs';

const MONDAY_API_KEY = 'eyJhbGciOiJIUzI1NiJ9.eyJ0aWQiOjQ0MjgwOTc1MCwiYWFpIjoxMSwidWlkIjo0MDc5NzY3NywiaWFkIjoiMjAyNC0xMS0yOVQyMDo0MzozNS4wMDBaIiwicGVyIjoibWU6d3JpdGUiLCJhY3RpZCI6MTU1OTc4MTUsInJnbiI6ImV1YzEifQ.kDaFO4cuWLy4Q4PbCe7mLuAGvbRRZAshbvuRG-b3b6U';
const BOARD_ID = '5094200598';

// Charger les contrats depuis le JSON
const contracts = JSON.parse(readFileSync('C:\\anapec\\contrats.json', 'utf8'));
console.log(`${contracts.length} contrats à envoyer vers Monday.com`);

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

// Récupérer les IDs des colonnes du board
async function getColumns() {
  const data = await mondayQuery(`{
    boards(ids: ${BOARD_ID}) {
      columns { id title type }
      groups { id title }
    }
  }`);
  return data.data?.boards?.[0];
}

// Créer un item dans Monday
async function createItem(groupId, itemName, columnValues) {
  const colValStr = JSON.stringify(JSON.stringify(columnValues));
  const query = `mutation {
    create_item(
      board_id: ${BOARD_ID},
      group_id: "${groupId}",
      item_name: "${itemName}",
      column_values: ${colValStr}
    ) { id }
  }`;
  return mondayQuery(query);
}

async function main() {
  console.log('\n=== Récupération de la structure du board ===');
  const board = await getColumns();
  
  if (!board) {
    console.log('Erreur: Board non trouvé. Vérifiez le BOARD_ID et API_KEY');
    return;
  }

  console.log('\nColonnes disponibles:');
  board.columns.forEach(c => console.log(`  ${c.id} | ${c.title} | ${c.type}`));
  
  console.log('\nGroupes:');
  board.groups.forEach(g => console.log(`  ${g.id} | ${g.title}`));

  // Trouver les groupes EN COURS et PROJET
  const groupEnCours = board.groups.find(g => g.title.toLowerCase().includes('en cours') || g.title.toLowerCase().includes('cours'));
  const groupProjet = board.groups.find(g => g.title.toLowerCase().includes('projet'));

  console.log(`\nGroupe EN COURS: ${groupEnCours?.id || 'non trouvé'}`);
  console.log(`Groupe PROJET: ${groupProjet?.id || 'non trouvé'}`);

  // Mapper les colonnes par titre
  const colMap = {};
  board.columns.forEach(c => { colMap[c.title] = c.id; });

  console.log('\n=== Envoi des contrats ===');
  let success = 0;
  let errors = 0;

  for (const contract of contracts) {
    // Déterminer le groupe selon l'état
    const isProjet = contract.etat?.toLowerCase().includes('projet');
    const groupId = isProjet 
      ? (groupProjet?.id || board.groups[0].id)
      : (groupEnCours?.id || board.groups[0].id);

    // Construire les valeurs des colonnes
    const columnValues = {};
    
    if (colMap['N° contrat ANAP']) columnValues[colMap['N° contrat ANAP']] = contract.ref || '';
    if (colMap['Etat ANAPEC']) columnValues[colMap['Etat ANAPEC']] = { label: contract.etat || '' };
    if (colMap['Type contrat']) columnValues[colMap['Type contrat']] = contract.type || '';
    if (colMap['CIN']) columnValues[colMap['CIN']] = contract.cin || '';
    if (colMap['Traitement CNSS']) columnValues[colMap['Traitement CNSS']] = { label: contract.cnss || 'Non renseigné' };
    
    if (contract.date_sig && contract.date_sig !== '---') {
      const [day, month, year] = contract.date_sig.split('/');
      if (day && month && year) {
        if (colMap['Date signature']) columnValues[colMap['Date signature']] = { date: `${year}-${month}-${day}` };
      }
    }
    
    if (contract.date_fin && contract.date_fin !== '---') {
      const [day, month, year] = contract.date_fin.split('/');
      if (day && month && year) {
        if (colMap['Date fin']) columnValues[colMap['Date fin']] = { date: `${year}-${month}-${day}` };
      }
    }

    const itemName = contract.ref || `Contrat-${Date.now()}`;
    
    try {
      const result = await createItem(groupId, itemName, columnValues);
      if (result.data?.create_item?.id) {
        console.log(`✓ ${itemName} → ID: ${result.data.create_item.id}`);
        success++;
      } else {
        console.log(`✗ Erreur pour ${itemName}:`, JSON.stringify(result.errors || result));
        errors++;
      }
    } catch (e) {
      console.log(`✗ Exception pour ${itemName}:`, e.message);
      errors++;
    }
    
    // Pause pour éviter le rate limit Monday
    await new Promise(r => setTimeout(r, 300));
  }

  console.log(`\n=== RÉSULTAT ===`);
  console.log(`✓ ${success} contrats envoyés avec succès`);
  console.log(`✗ ${errors} erreurs`);
}

main().catch(console.error);
