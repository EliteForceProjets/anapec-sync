import { readFileSync, readdirSync, writeFileSync } from 'fs';

const MONDAY_API_KEY = 'eyJhbGciOiJIUzI1NiJ9.eyJ0aWQiOjQ0MjgwOTc1MCwiYWFpIjoxMSwidWlkIjo0MDc5NzY3NywiaWFkIjoiMjAyNC0xMS0yOVQyMDo0MzozNS4wMDBaIiwicGVyIjoibWU6d3JpdGUiLCJhY3RpZCI6MTU1OTc4MTUsInJnbiI6ImV1YzEifQ.kDaFO4cuWLy4Q4PbCe7mLuAGvbRRZAshbvuRG-b3b6U';
const BOARD_ID = '5094200598';

const COL = {
  ref:        'text_mm25bmx6',
  nom_entrep: 'text_mm25b5td',
  secteur:    'text_mm25anzf',
  adresse:    'text_mm25sj8x',
  telephone:  'phone_mm25494m',
  cnss_empl:  'text_mm25pz5s',
  rc:         'text_mm25qwwm',
  forme_jur:  'text_mm25c1zg',
  nom_agent:  'text_mm256r65',
  prenom:     'text_mm25rm0q',
  nationalite:'text_mm257ne0',
  cin:        'text_mm25ycje',
  cnss_agent: 'text_mm25vspv',
  niveau:     'text_mm25dcs7',
  poste:      'text_mm25x2aw',
  duree:      'numeric_mm25fr45',
  salaire:    'numeric_mm25aj7f',
  agence:     'text_mm255qz2',
  email:      'text_mm25cb1c'
};

function clean(s) {
  return (s || '').replace(/&nbsp;/g, ' ').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

function parseContractPrint(html) {
  // Extraire tout le texte visible
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n/g, '\n')
    .trim();

  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 1);
  
  const data = {};
  
  // Chercher des patterns spécifiques dans le texte complet
  const find = (patterns) => {
    for (const p of patterns) {
      const m = text.match(p);
      if (m && m[1] && m[1].trim().length > 0) return m[1].trim();
    }
    return '';
  };

  // Numéro contrat
  data.ref = find([
    /الاتفاقية رقم\s*[:\s]*([AI][0-9\/]+)/,
    /([AI]\d{10,}\/\d+)/,
    /Accord[^\n]*\n[^\n]*([AI]\d{10,}\/\d+)/
  ]);

  // Entreprise
  data.nom_entrep = find([
    /الاسم [أا]و المقاول[^:\n]*[:\n]\s*([^\n]{3,80})/,
    /GRUPO[^\n]*/,
    /Nom[^:\n]*entreprise[^:\n]*:\s*([^\n]{3,80})/
  ]) || (text.match(/GRUPO[^\n,]*/)?.[0] || '');

  data.secteur = find([
    /قطاع النشاط[^:\n]*[:\n]\s*([^\n]{3,80})/,
    /[Ss]ecteur[^:\n]*[:\n]\s*([^\n]{3,80})/,
    /Services fournis[^\n]*/
  ]) || (text.match(/Services [^\n]*/)?.[0] || '');

  data.adresse = find([
    /العنوان[^:\n]*[:\n]\s*([^\n]{5,150})/,
    /[Aa]dresse[^:\n]*[:\n]\s*([^\n]{5,150})/,
    /Plateau[^\n]*/
  ]) || (text.match(/Plateau[^\n]*/)?.[0] || '');

  data.telephone = find([
    /الهاتف[^:\n]*[:\n]\s*([\d\s\/+]{8,20})/,
    /[Tt][eé]l[^:\n]*[:\n]\s*([\d\s\/+]{8,20})/,
    /GSM[^:\n]*[:\n]\s*([\d\s\/+]{8,20})/,
    /(0\d{8,9}[\s\/]*0?\d{0,9})/
  ]);

  data.rc = find([
    /رقم القيد في السجل التجاري[^:\n]*[:\n]\s*(\d+)/,
    /RC[^:\n]*[:\n]\s*(\d+)/,
    /registre[^:\n]*[:\n]\s*(\d+)/
  ]);

  data.cnss_empl = find([
    /رقم الانخراط في الصندوق الوطني للضمان الاجتماعي[^:\n]*[:\n]\s*(\d+)/,
    /CNSS[^:\n]*employeur[^:\n]*[:\n]\s*(\d+)/
  ]);

  data.forme_jur = find([
    /النظام القانوني[^:\n]*[:\n]\s*([^\n]{3,50})/,
    /[Ff]orme juridique[^:\n]*[:\n]\s*([^\n]{3,50})/,
    /Société[^\n]*/,
    /SARL[^\n]*/
  ]) || (text.match(/Société[^\n,]*/)?.[0] || '');

  // Agent/Stagiaire  
  data.nom_agent = find([
    /الاسم العائلي[^:\n]*[:\n]\s*([^\n]{2,40})/,
    /[Nn]om[^:\n]*agent[^:\n]*[:\n]\s*([^\n]{2,40})/,
    /[Nn]om[^:\n]*[:\n]\s*([A-Z][A-Z\s]{2,30})/
  ]);

  data.prenom = find([
    /الاسم الشخصي[^:\n]*[:\n]\s*([^\n]{2,40})/,
    /[Pp]r[eé]nom[^:\n]*[:\n]\s*([^\n]{2,40})/
  ]);

  data.nationalite = find([
    /الجنسية[^:\n]*[:\n]\s*([^\n]{3,30})/,
    /[Nn]ationalit[eé][^:\n]*[:\n]\s*([^\n]{3,30})/
  ]);

  data.cin = find([
    /رقم بطاقة التعريف[^:\n]*[:\n]\s*([A-Z]{1,2}\d{4,8})/,
    /CIN[^:\n]*[:\n]\s*([A-Z]{1,2}\d{4,8})/,
    /([A-Z]{1,2}\d{5,8})/
  ]);

  data.cnss_agent = find([
    /رقم التسجيل بالصندوق[^:\n]*[:\n]\s*(\d{6,12})/,
    /N°\s*CNSS[^:\n]*[:\n]\s*(\d{6,12})/
  ]);

  data.niveau = find([
    /المستوى التعليمي[^:\n]*[:\n]\s*([^\n]{3,50})/,
    /[Nn]iveau[^:\n]*[:\n]\s*([^\n]{3,50})/
  ]);

  data.poste = find([
    /المهنة[^:\n]*[:\n]\s*([^\n]{3,60})/,
    /[Pp]oste[^:\n]*[:\n]\s*([^\n]{3,60})/,
    /agent de nettoyage/i,
    /[Ff]onction[^:\n]*[:\n]\s*([^\n]{3,60})/
  ]) || (text.match(/agent de nettoyage/i)?.[0] || '');

  data.duree = find([
    /المدة[^:\n]*[:\n]\s*(\d+)/,
    /[Dd]ur[eé]e[^:\n]*[:\n]\s*(\d+)/,
    /(\d+)\s*[مm]ois/
  ]);

  data.salaire = find([
    /الأجر[^:\n]*[:\n]\s*([\d\s.,]+)/,
    /[Ss]alaire[^:\n]*[:\n]\s*([\d\s.,]+)/,
    /(\d{3,6})\s*[dD][hH]/,
    /entre\s*([\d]+)\s*et/
  ]);

  data.agence = find([
    /الوكالة[^:\n]*[:\n]\s*([^\n]{3,60})/,
    /[Aa]gence[^:\n]*[:\n]\s*([^\n]{3,60})/
  ]);

  // Afficher le texte pour debug
  data._text_sample = lines.slice(0, 30).join(' | ');

  return data;
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

async function getMondayItems() {
  const data = await mondayQuery(`{
    boards(ids: ${BOARD_ID}) {
      items_page(limit: 50) {
        items { id name column_values { id text } }
      }
    }
  }`);
  return data.data?.boards?.[0]?.items_page?.items || [];
}

async function updateItem(itemId, columnValues) {
  const colValStr = JSON.stringify(JSON.stringify(columnValues));
  return mondayQuery(`mutation {
    change_multiple_column_values(
      board_id: ${BOARD_ID}, item_id: ${itemId},
      column_values: ${colValStr}
    ) { id }
  }`);
}

async function main() {
  const files = readdirSync('C:\\anapec\\').filter(f => f.startsWith('ci_') && f.endsWith('.html'));
  console.log(`=== ${files.length} fichiers trouvés ===\n`);

  const items = await getMondayItems();
  const itemByName = {};
  items.forEach(item => { itemByName[item.name] = item.id; });
  console.log(`Items Monday: ${items.map(i=>i.name).join(', ')}\n`);

  let success = 0, errors = 0;

  for (const file of files) {
    console.log(`\n=== ${file} ===`);
    const html = readFileSync(`C:\\anapec\\${file}`, 'utf8');
    const data = parseContractPrint(html);
    
    console.log(`Ref: "${data.ref}"`);
    console.log(`Entreprise: "${data.nom_entrep}"`);
    console.log(`Adresse: "${data.adresse}"`);
    console.log(`Tel: "${data.telephone}"`);
    console.log(`Forme jur: "${data.forme_jur}"`);
    console.log(`Nom agent: "${data.nom_agent}"`);
    console.log(`Prénom: "${data.prenom}"`);
    console.log(`CIN: "${data.cin}"`);
    console.log(`Poste: "${data.poste}"`);
    console.log(`Salaire: "${data.salaire}"`);
    console.log(`Durée: "${data.duree}"`);
    console.log(`Texte sample: ${data._text_sample?.substring(0,200)}`);

    // Trouver item Monday
    let itemId = null;
    for (const [name, id] of Object.entries(itemByName)) {
      const refBase = (data.ref || '').replace('/1','').replace('/','');
      if (name.includes(refBase) || (data.ref && name === data.ref)) {
        itemId = id;
        break;
      }
    }

    if (!itemId) {
      console.log(`⚠ Item non trouvé. Ref="${data.ref}"`);
      errors++;
      continue;
    }

    const cv = {};
    const set = (col, val) => { if (val && String(val).trim()) cv[col] = String(val).trim(); };
    const setNum = (col, val) => {
      const n = parseFloat(String(val||'').replace(/[^\d.]/g,''));
      if (!isNaN(n) && n > 0) cv[col] = n;
    };

    set(COL.nom_entrep, data.nom_entrep);
    set(COL.secteur, data.secteur);
    set(COL.adresse, data.adresse);
    set(COL.telephone, data.telephone);
    set(COL.rc, data.rc);
    set(COL.cnss_empl, data.cnss_empl);
    set(COL.forme_jur, data.forme_jur);
    set(COL.nom_agent, data.nom_agent);
    set(COL.prenom, data.prenom);
    set(COL.nationalite, data.nationalite);
    set(COL.cin, data.cin);
    set(COL.cnss_agent, data.cnss_agent);
    set(COL.niveau, data.niveau);
    set(COL.poste, data.poste);
    set(COL.agence, data.agence);
    setNum(COL.duree, data.duree);
    setNum(COL.salaire, data.salaire);

    console.log(`${Object.keys(cv).length} colonnes à mettre à jour`);

    if (Object.keys(cv).length > 0) {
      const result = await updateItem(itemId, cv);
      if (result.data?.change_multiple_column_values?.id) {
        console.log(`✓ Mis à jour !`);
        success++;
      } else {
        console.log(`✗ ${result.errors?.[0]?.message}`);
        errors++;
      }
    }
    await new Promise(r => setTimeout(r, 400));
  }

  console.log(`\n=== RÉSULTAT: ✓${success} / ✗${errors} ===`);
}

main().catch(console.error);
