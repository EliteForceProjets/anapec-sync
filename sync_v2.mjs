import { readFileSync, readdirSync } from 'fs';

const LAMBDA_URL = 'https://l2glt7wxrutmhmpf73aqka2id4oowudw.lambda-url.eu-north-1.on.aws/';

function parseDetail(html) {
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

  return {
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

async function main() {
  console.log('=== Synchronisation ANAPEC → Lambda → Monday ===');
  console.log(`Date: ${new Date().toLocaleString('fr-FR')}`);

  // 1. Lire contrats.json
  const baseContracts = JSON.parse(readFileSync('C:\\anapec\\contrats.json', 'utf8'));
  console.log(`${baseContracts.length} contrats dans contrats.json`);

  // 2. Lire les fichiers détails ci_*.html
  const files = readdirSync('C:\\anapec\\').filter(f => f.startsWith('ci_') && f.endsWith('.html'));
  console.log(`${files.length} fichiers détails trouvés`);

  // Construire map ref → détails
  const detailMap = {};
  for (const file of files) {
    const html = readFileSync(`C:\\anapec\\${file}`, 'utf8');
    const detail = parseDetail(html);
    const refMatch = html.replace(/<[^>]+>/g,' ').match(/([AI]\d{10,}\/\d+)/);
    const ref = refMatch?.[1] || '';
    if (ref) detailMap[ref] = detail;
  }

  // 3. Fusionner
  const fullContracts = baseContracts.map(c => ({
    ref:      c.ref || '',
    date_sig: c.date_sig || '',
    date_fin: c.date_fin || '',
    etat:     c.etat || '',
    type:     c.type || '',
    cin:      c.cin || '',
    cnss:     c.cnss || '',
    ...(detailMap[c.ref] || {})
  }));

  console.log('\nContrats à envoyer:');
  fullContracts.forEach(c => console.log(`  ${c.ref} | ${c.etat} | CIN:${c.cin} | Agent:${c.nom_agent||''}`));

  // 4. Envoyer vers Lambda
  console.log(`\nEnvoi de ${fullContracts.length} contrats vers Lambda...`);
  try {
    const res = await fetch(LAMBDA_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contracts: fullContracts })
    });
    const result = await res.json();
    console.log('\n=== Résultat Lambda ===');
    console.log(JSON.stringify(result, null, 2));
  } catch(e) {
    console.log(`Erreur: ${e.message}`);
  }
}

main().catch(console.error);
