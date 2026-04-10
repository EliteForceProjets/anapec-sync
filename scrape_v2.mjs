process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

import { writeFileSync } from 'fs';

const SESSION_COOKIE = 'CAKEPHP=0iq3k45ofevhm808dtah0ukq20; CakeCookie[Employeur]=Q2FrZQ%3D%3D.A3ZdNf2tpnDA3jzixaP3LMqsF7zgxIzkiC9i0z9bLjj%2BiZ8ZeCPrZThulAD5bDve';

const CONTRAT_URL = 'https://www.anapec.org/sigec-app-rv/fr/entreprises/visualiser_contrat';

async function main() {
  console.log('=== Récupération des contrats ANAPEC ===');
  
  const res = await fetch(CONTRAT_URL, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'fr-FR,fr;q=0.9',
      'Cookie': SESSION_COOKIE,
      'Referer': 'https://www.anapec.org/sigec-app-rv/fr/entreprises/index'
    }
  });
  
  const html = await res.text();
  console.log(`Status: ${res.status}`);
  console.log(`Taille: ${html.length} chars`);
  
  // Diagnostic
  const title = html.match(/<title[^>]*>(.*?)<\/title>/i)?.[1] || 'non trouvé';
  console.log(`Title: ${title}`);
  console.log(`Contient "visualiser_contrat": ${html.includes('visualiser_contrat')}`);
  console.log(`Contient "Ref contrat": ${html.includes('Ref contrat')}`);
  console.log(`Nombre de <td>: ${(html.match(/<td/gi)||[]).length}`);
  console.log(`Nombre de <tr>: ${(html.match(/<tr/gi)||[]).length}`);
  
  writeFileSync('C:\\anapec\\contrats_v2.html', html);
  console.log('Sauvegardé dans C:\\anapec\\contrats_v2.html');

  // Parser toutes les lignes TR avec TD
  const allRows = [];
  const trPattern = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let trMatch;
  while ((trMatch = trPattern.exec(html)) !== null) {
    const tds = trMatch[1].match(/<td[^>]*>([\s\S]*?)<\/td>/gi) || [];
    if (tds.length >= 3) {
      const cells = tds.map(td => td.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
      allRows.push(cells);
    }
  }
  
  console.log(`\nLignes avec 3+ colonnes: ${allRows.length}`);
  
  if (allRows.length > 0) {
    allRows.forEach((row, i) => {
      console.log(`${i+1}. ${row.join(' | ')}`);
    });
    
    const contracts = allRows.map(row => ({
      ref_contrat: row[0] || '',
      date_signature: row[1] || '',
      date_fin: row[2] || '',
      etat_anapec: row[3] || '',
      type: row[4] || '',
      cin: row[5] || '',
      traitement_cnss: row[6] || ''
    }));
    
    writeFileSync('C:\\anapec\\contrats.json', JSON.stringify(contracts, null, 2));
    console.log(`\n✓ ${contracts.length} contrats exportés vers C:\\anapec\\contrats.json`);
  }
}

main().catch(console.error);
