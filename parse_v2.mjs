import { readFileSync, readdirSync } from 'fs';

const MONDAY_API_KEY = 'eyJhbGciOiJIUzI1NiJ9.eyJ0aWQiOjQ0MjgwOTc1MCwiYWFpIjoxMSwidWlkIjo0MDc5NzY3NywiaWFkIjoiMjAyNC0xMS0yOVQyMDo0MzozNS4wMDBaIiwicGVyIjoibWU6d3JpdGUiLCJhY3RpZCI6MTU1OTc4MTUsInJnbiI6ImV1YzEifQ.kDaFO4cuWLy4Q4PbCe7mLuAGvbRRZAshbvuRG-b3b6U';
const BOARD_ID = '5094200598';

const COL = {
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

function parseContract(html) {
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/td>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/[ \t]+/g, ' ')
    .split('\n').map(l=>l.trim()).filter(l=>l.length>1).join('\n');

  const find = (...patterns) => {
    for (const p of patterns) {
      const m = text.match(p);
      if (m?.[1]?.trim()) return m[1].trim();
    }
    return '';
  };

  // Agence
  const agence = find(/الوكالة\s*:\s*([^\n|]{3,60})/);
  
  // Entreprise - chercher après "المشغل" ou "رب العمل"
  const nom_entrep = find(
    /الاسم [أا]و المقاول[^:\n]*:\s*([^\n]{3,80})/,
    /GRUPO[^\n,]*/
  ) || (text.match(/GRUPO[^\n]*/)?.[0]?.split('\n')[0] || '');

  const secteur = find(
    /قطاع النشاط[^:\n]*:\s*([^\n]{3,80})/,
    /Services[^\n]*/
  ) || (text.match(/Services fournis[^\n]*/)?.[0] || '');

  // Adresse - après العنوان
  const adresse = find(/العنوان\s*:\s*([^\n]{5,150})/,/Plateau[^\n]*/);

  // Téléphone - extraire uniquement les chiffres
  const telRaw = find(/الهاتف[^:\n]*:\s*([\d\s\/+]{8,30})/,/(0\d{8})/);
  const telephone = telRaw.replace(/[^\d]/g,'').substring(0,10);

  const rc = find(/رقم القيد في السجل التجاري[^:\n]*:\s*(\d+)/,/RC[^:\n]*:\s*(\d+)/);
  const cnss_empl = find(/رقم الانخراط[^:\n]*:\s*(\d+)/);
  const forme_jur = find(/النظام القانوني[^:\n]*:\s*([^\n]{3,60})/,/Société[^\n]*/);

  // Agent - après "المتدرب"
  const nom_agent = find(/الاسم العائلي[^:\n]*:\s*([^\n]{2,40})/);
  const prenom = find(/الاسم الشخصي[^:\n]*:\s*([^\n]{2,40})/);
  const nationalite = find(/الجنسية[^:\n]*:\s*([^\n]{3,30})/);
  
  // CIN - format XX + chiffres (ex: SH176322, JA72148)
  const cinRaw = find(/رقم بطاقة التعريف[^:\n]*:\s*([A-Z]{1,2}\d{4,8})/,/CIN[^:\n]*:\s*([A-Z]{1,2}\d{4,8})/);
  const cin = cinRaw || (text.match(/\b([A-Z]{1,2}\d{5,8})\b/)?.[1] || '');
  
  const cnss_agent = find(/رقم التسجيل بالصندوق[^:\n]*:\s*(\d{6,12})/);
  const niveau = find(/المستوى التعليمي[^:\n]*:\s*([^\n]{3,60})/);
  const poste = find(/المهنة[^:\n]*:\s*([^\n]{3,60})/,/agent de nettoyage/i,/AGENT DE NETTOYAGE/);
  const duree = find(/المدة[^:\n]*:\s*(\d+)/,/(\d+)\s*شهر/,/(\d+)\s*mois/i);
  const salaire = find(/الأجر[^:\n]*:\s*([\d\s.,]+)/,/(\d{3,5})\s*درهم/,/(\d{3,5})\s*DH/i);
  const email = find(/البريد[^:\n]*:\s*([^\s@]+@[^\s]+)/,/Email[^:\n]*:\s*([^\s@]+@[^\s]+)/i);

  return { agence, nom_entrep, secteur, adresse, telephone, rc, cnss_empl, 
           forme_jur, nom_agent, prenom, nationalite, cin, cnss_agent,
           niveau, poste, duree, salaire, email };
}

async function mondayQuery(query) {
  const res = await fetch('https://api.monday.com/v2', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': MONDAY_API_KEY, 'API-Version': '2024-01' },
    body: JSON.stringify({ query })
  });
  return res.json();
}

async function getMondayItems() {
  const d = await mondayQuery(`{ boards(ids: ${BOARD_ID}) { items_page(limit: 50) { items { id name column_values { id text } } } } }`);
  return d.data?.boards?.[0]?.items_page?.items || [];
}

async function updateItem(itemId, cv) {
  const s = JSON.stringify(JSON.stringify(cv));
  return mondayQuery(`mutation { change_multiple_column_values(board_id: ${BOARD_ID}, item_id: ${itemId}, column_values: ${s}) { id } }`);
}

async function main() {
  const files = readdirSync('C:\\anapec\\').filter(f => f.startsWith('ci_') && f.endsWith('.html'));
  const items = await getMondayItems();
  
  const itemByName = {};
  items.forEach(i => { itemByName[i.name] = i.id; });

  let success = 0, errors = 0;

  for (const file of files) {
    const html = readFileSync(`C:\\anapec\\${file}`, 'utf8');
    const d = parseContract(html);
    
    // Trouver ref dans le texte
    const text = html.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ');
    const refMatch = text.match(/([AI]\d{10,}\/\d+)/);
    const ref = refMatch?.[1] || '';
    const refBase = ref.replace(/^[AI]/, 'AI').replace('/1','');

    console.log(`\n${file}: ref=${ref}, nom=${d.nom_agent}, cin=${d.cin}, agence=${d.agence}`);

    let itemId = itemByName[ref] || itemByName[refBase];
    if (!itemId) {
      for (const [name, id] of Object.entries(itemByName)) {
        if (refBase && name.replace(/\D/g,'').includes(refBase.replace(/\D/g,''))) {
          itemId = id; break;
        }
      }
    }

    if (!itemId) { console.log(`⚠ Non trouvé`); errors++; continue; }

    const cv = {};
    const set = (col, val) => { if (val?.trim()) cv[col] = val.trim(); };
    const setNum = (col, val) => { const n=parseFloat(String(val||'').replace(/[^\d.]/g,'')); if(!isNaN(n)&&n>0) cv[col]=n; };

    set(COL.nom_entrep, d.nom_entrep);
    set(COL.secteur, d.secteur);
    set(COL.adresse, d.adresse);
    set(COL.rc, d.rc);
    set(COL.cnss_empl, d.cnss_empl);
    set(COL.forme_jur, d.forme_jur);
    set(COL.nom_agent, d.nom_agent);
    set(COL.prenom, d.prenom);
    set(COL.nationalite, d.nationalite);
    set(COL.cin, d.cin);
    set(COL.cnss_agent, d.cnss_agent);
    set(COL.niveau, d.niveau);
    set(COL.poste, d.poste);
    set(COL.agence, d.agence);
    set(COL.email, d.email);
    setNum(COL.duree, d.duree);
    setNum(COL.salaire, d.salaire);

    // Téléphone format Monday
    if (d.telephone && d.telephone.length >= 9) {
      cv[COL.telephone] = { phone: d.telephone, countryShortName: 'MA' };
    }

    const result = await updateItem(itemId, cv);
    if (result.data?.change_multiple_column_values?.id) {
      console.log(`✓ ${Object.keys(cv).length} colonnes mises à jour`);
      success++;
    } else {
      console.log(`✗ ${result.errors?.[0]?.message}`);
      errors++;
    }
    await new Promise(r => setTimeout(r, 400));
  }

  console.log(`\n=== ✓${success} succès / ✗${errors} erreurs ===`);
}

main().catch(console.error);
