// Script local - scrape ANAPEC et envoie vers Lambda
import { readFileSync, readdirSync } from 'fs';

// URL de votre fonction Lambda (à remplacer après déploiement)
const LAMBDA_URL = 'https://l2glt7wxrutmhmpf73aqka2id4oowudw.lambda-url.eu-north-1.on.aws/';

function parseContract(html) {
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/td>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/[ \t]+/g, ' ');

  const find = (...patterns) => {
    for (const p of patterns) {
      const m = text.match(p);
      if (m?.[1]?.trim()) return m[1].trim();
    }
    return '';
  };

  const refMatch = text.replace(/<[^>]+>/g,' ').match(/([AI]\d{10,}\/\d+)/);
  
  return {
    ref:        refMatch?.[1] || '',
    agence:     find(/الوكالة\s*:\s*([^\n|]{3,60})/),
    nom_entrep: find(/الاسم [أا]و المقاول[^:\n]*:\s*([^\n]{3,80})/) || (text.match(/GRUPO[^\n,]*/)?.[0] || ''),
    secteur:    find(/قطاع النشاط[^:\n]*:\s*([^\n]{3,80})/) || (text.match(/Services fournis[^\n]*/)?.[0] || ''),
    adresse:    find(/العنوان\s*:\s*([^\n]{5,150})/),
    telephone:  find(/(0\d{8,9})/),
    rc:         find(/رقم القيد في السجل التجاري[^:\n]*:\s*(\d+)/),
    cnss_empl:  find(/رقم الانخراط[^:\n]*:\s*(\d+)/),
    forme_jur:  find(/النظام القانوني[^:\n]*:\s*([^\n]{3,60})/),
    nom_agent:  find(/الاسم العائلي[^:\n]*:\s*([^\n]{2,40})/),
    prenom:     find(/الاسم الشخصي[^:\n]*:\s*([^\n]{2,40})/),
    nationalite:find(/الجنسية[^:\n]*:\s*([^\n]{3,30})/),
    cin:        text.match(/\b([A-Z]{1,2}\d{5,8})\b/)?.[1] || '',
    cnss_agent: find(/رقم التسجيل بالصندوق[^:\n]*:\s*(\d{6,12})/),
    niveau:     find(/المستوى التعليمي[^:\n]*:\s*([^\n]{3,60})/),
    poste:      find(/المهنة[^:\n]*:\s*([^\n]{3,60})/, /agent de nettoyage/i),
    duree:      find(/المدة[^:\n]*:\s*(\d+)/),
    salaire:    find(/الأجر[^:\n]*:\s*([\d\s.,]+)/),
  };
}

function parseContractsList(html) {
  const contracts = [];
  const trPattern = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let m;
  while ((m = trPattern.exec(html)) !== null) {
    const tds = m[1].match(/<td[^>]*>([\s\S]*?)<\/td>/gi) || [];
    if (tds.length >= 3) {
      const cells = tds.map(td => td.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim());
      if (cells[0] && /^[AI]\d/.test(cells[0])) {
        contracts.push({
          ref: cells[0], date_sig: cells[1], date_fin: cells[2],
          etat: cells[3], type: cells[4], cin: cells[5], cnss: cells[6]
        });
      }
    }
  }
  return contracts;
}

async function sendToLambda(contracts) {
  console.log(`Envoi de ${contracts.length} contrats vers Lambda...`);
  
  const body = JSON.stringify({ contracts });
  
  const res = await fetch(LAMBDA_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body
  });
  
  const result = await res.json();
  return result;
}

async function main() {
  console.log('=== Synchronisation ANAPEC → Lambda → Monday ===');
  console.log(`Date: ${new Date().toLocaleString('fr-FR')}`);

  // 1. Lire la liste des contrats
  const listHtml = readFileSync('C:\\anapec\\contrats_direct.html', 'utf8');
  const baseContracts = parseContractsList(listHtml);
  console.log(`${baseContracts.length} contrats dans la liste`);

  // 2. Enrichir avec les détails de chaque contrat
  const files = readdirSync('C:\\anapec\\').filter(f => f.startsWith('ci_') && f.endsWith('.html'));
  console.log(`${files.length} fichiers détails trouvés`);

  const detailMap = {};
  for (const file of files) {
    const html = readFileSync(`C:\\anapec\\${file}`, 'utf8');
    const detail = parseContract(html);
    if (detail.ref) detailMap[detail.ref] = detail;
  }

  // 3. Fusionner liste + détails
  const fullContracts = baseContracts.map(c => ({
    ...c,
    ...(detailMap[c.ref] || {})
  }));

  console.log('\nContrats à envoyer:');
  fullContracts.forEach(c => console.log(`  ${c.ref} | ${c.etat} | ${c.cin} | ${c.agence}`));

  // 4. Envoyer vers Lambda
  try {
    const result = await sendToLambda(fullContracts);
    console.log('\n=== Résultat Lambda ===');
    console.log(JSON.stringify(result, null, 2));
  } catch(e) {
    console.log(`Erreur envoi Lambda: ${e.message}`);
  }
}

main().catch(console.error);
