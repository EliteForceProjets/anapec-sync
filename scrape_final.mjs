process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

import { writeFileSync } from 'fs';

const SESSION_COOKIE = 'CAKEPHP=0iq3k45ofevhm808dtah0ukq20; CakeCookie[Employeur]=Q2FrZQ%3D%3D.A3ZdNf2tpnDA3jzixaP3LMqsF7zgxIzkiC9i0z9bLjj%2BiZ8ZeCPrZThulAD5bDve';

const BASE_URL = 'https://www.anapec.org/sigec-app-rv';
const CONTRAT_URL = `${BASE_URL}/fr/entreprises/visualiser_contrat`;

async function fetchPage(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120',
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'fr-FR,fr;q=0.9',
      'Cookie': SESSION_COOKIE,
    }
  });
  return { status: res.status, html: await res.text() };
}

function parseTable(html) {
  const rows = [];
  const tbody = html.match(/<tbody[^>]*>([\s\S]*?)<\/tbody>/i);
  if (!tbody) return rows;
  const trs = tbody[1].match(/<tr[^>]*>([\s\S]*?)<\/tr>/gi) || [];
  trs.forEach(tr => {
    const tds = tr.match(/<td[^>]*>([\s\S]*?)<\/td>/gi) || [];
    const cells = tds.map(td => td.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
    if (cells.length > 0) rows.push(cells);
  });
  return rows;
}

async function main() {
  console.log('=== Récupération des contrats ANAPEC ===');
  const { status, html } = await fetchPage(CONTRAT_URL);
  console.log(`Status: ${status}`);

  writeFileSync('C:\\anapec\\contrats_auth.html', html);
  console.log(`Page sauvegardée (${html.length} chars)`);

  const isLoginPage = html.includes('mot_de_passe') || html.includes('password');
  if (isLoginPage) {
    console.log('⚠️  Session expirée — récupérez un nouveau cookie !');
    return;
  }

  const rows = parseTable(html);
  console.log(`\n=== ${rows.length} contrats trouvés ===\n`);

  if (rows.length > 0) {
    rows.forEach((row, i) => {
      console.log(`${i+1}. ${row.slice(0,7).join(' | ')}`);
    });

    const contracts = rows.map(row => ({
      ref_contrat: row[0] || '',
      date_signature: row[1] || '',
      date_fin: row[2] || '',
      etat_anapec: row[3] || '',
      type: row[4] || '',
      cin: row[5] || '',
      traitement_cnss: row[6] || ''
    }));

    writeFileSync('C:\\anapec\\contrats.json', JSON.stringify(contracts, null, 2));
    console.log(`\n✓ Exporté vers C:\\anapec\\contrats.json`);
    console.log(`✓ ${contracts.length} contrats exportés`);
  } else {
    console.log('Tableau vide — vérification HTML...');
    const tableCount = (html.match(/<table/gi) || []).length;
    const tdCount = (html.match(/<td/gi) || []).length;
    console.log(`Tables: ${tableCount}, Cellules: ${tdCount}`);
  }
}

main().catch(console.error);
