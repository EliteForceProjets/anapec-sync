import https from "https";
import http from "http";
import { JSDOM } from "jsdom";

// ==========================
// ⚙️  MODIFIEZ CES VALEURS
// ==========================

const MONDAY_API_KEY  = "eyJhbGciOiJIUzI1NiJ9.eyJ0aWQiOjQ0MjgwOTc1MCwiYWFpIjoxMSwidWlkIjo0MDc5NzY3NywiaWFkIjoiMjAyNC0xMS0yOVQyMDo0MzozNS4wMDBaIiwicGVyIjoibWU6d3JpdGUiLCJhY3RpZCI6MTU1OTc4MTUsInJnbiI6ImV1YzEifQ.kDaFO4cuWLy4Q4PbCe7mLuAGvbRRZAshbvuRG-b3b6U";

const MONDAY_BOARD_ID = "5094200598";

const SOCIETES = [
  { email: "grupoteyez@gmail.com", password: "123456", nom: "GRUPO TEYEZ" },
  // Ajoutez d'autres sociétés ici :
  // { email: "societe2@gmail.com", password: "motdepasse2", nom: "SOCIETE 2" },
];

// ==========================
// ⚙️  NE PAS MODIFIER
// ==========================

const MONDAY_API_URL      = "https://api.monday.com/v2";
const ANAPEC_BASE_URL     = "https://www.anapec.org:443";
const ANAPEC_LOGIN_URL = ANAPEC_BASE_URL + "/sigec-app-rv/fr/entreprises/login";
const ANAPEC_CONTRATS_URL = `${ANAPEC_BASE_URL}/sigec-app-rv/fr/entreprises/visualiser_contrat`;

// ==========================
// 🚀 LANCEMENT PRINCIPAL
// ==========================

console.log("🚀 DEBUT - ANAPEC → Monday.com");
console.log(`📊 ${SOCIETES.length} société(s) à traiter\n`);

let totalContrats = 0;

for (const societe of SOCIETES) {

  console.log(`\n📧 Traitement: ${societe.email} (${societe.nom})`);

  try {

    const { cookies } = await loginAnapec(societe.email, societe.password);
    console.log(`🔐 Connecté à ANAPEC ✅`);

    const contrats = await getListeContrats(cookies);
    console.log(`📋 ${contrats.length} contrat(s) trouvé(s)`);

    for (const contrat of contrats) {
      console.log(`\n🔍 Contrat: ${contrat.refContrat}`);
      const detail  = await getDetailContrat(cookies, contrat.url);
      const donnees = { ...contrat, ...detail, emailSociete: societe.email, nomSociete: societe.nom };
      const itemId  = await createMondayItem(donnees);
      console.log(`✅ Créé dans Monday - ID: ${itemId}`);
      totalContrats++;
    }

  } catch (err) {
    console.error(`🔥 Erreur pour ${societe.email}:`, err.message);
  }
}

console.log(`\n🎯 TERMINÉ - ${totalContrats} contrat(s) transféré(s) dans Monday`);

// ==========================
// 🔐 CONNEXION ANAPEC
// ==========================

async function loginAnapec(email, password) {
  let jar = {};
  const p1 = await GET(ANAPEC_BASE_URL + "/sigec-app-rv/fr/entreprises/login", jar);
  mergeCookies(jar, p1.cookies);
  const postData = new URLSearchParams({ 
    "data[cherch_empl][identifiant]": email,
    "data[cherch_empl][mot_pass]": password
  }).toString();
  const p2 = await POST(ANAPEC_BASE_URL + "/sigec-app-rv/fr/entreprises/login", postData, jar);
  mergeCookies(jar, p2.cookies);
  console.log("   POST status: " + p2.status);
  if (p2.status === 302) {
    let loc = p2.headers["location"] || "";
    if (!loc.startsWith("http")) loc = ANAPEC_BASE_URL + loc;
    const p3 = await GET(loc, jar);
    mergeCookies(jar, p3.cookies);
  }
  const check = await GET(ANAPEC_CONTRATS_URL, jar);
  mergeCookies(jar, check.cookies);
  const titleEl = new JSDOM(check.body).window.document.querySelector("title");
  const title = titleEl ? titleEl.textContent : "";
  console.log("   Page: " + title.substring(0,50));
  if (title.toLowerCase().includes("recrutement") || title.toLowerCase().includes("emploi")) {
    throw new Error("Login echoue - redirige vers page publique");
  }
  return jar;
}
// ==========================
// 📋 LISTE DES CONTRATS
// ==========================

async function getListeContrats(cookies) {

  const resp = await httpGet(ANAPEC_CONTRATS_URL, cookies);
  const dom  = new JSDOM(resp.body);
  const rows = dom.window.document.querySelectorAll("table tbody tr");
  const contrats = [];

  rows.forEach(row => {
    const cells      = row.querySelectorAll("td");
    if (cells.length < 6) return;
    const lienDetail = row.querySelector('a[href*="edition_ci"]');
    contrats.push({
      refContrat     : cells[0]?.textContent?.trim() || "",
      dateSignature  : cells[1]?.textContent?.trim() || "",
      dateFin        : cells[2]?.textContent?.trim() || "",
      etatAnapec     : cells[3]?.textContent?.trim() || "",
      typeContrat    : cells[4]?.textContent?.trim() || "",
      cin            : cells[5]?.textContent?.trim() || "",
      traitementCnss : cells[6]?.textContent?.trim() || "",
      url            : lienDetail ? `${ANAPEC_BASE_URL}${lienDetail.getAttribute("href")}` : "",
    });
  });

  return contrats.filter(c => c.refContrat);
}

// ==========================
// 🔍 DÉTAIL D'UN CONTRAT
// ==========================

async function getDetailContrat(cookies, url) {

  if (!url) return {};
  const resp = await httpGet(url, cookies);
  const dom  = new JSDOM(resp.body);
  const doc  = dom.window.document;

  const extract = (label) => {
    const els = doc.querySelectorAll("td, span, div, p");
    for (const el of els) {
      if (el.textContent.trim().includes(label)) {
        const next = el.nextElementSibling;
        if (next) return next.textContent.trim();
        const txt = el.parentElement?.textContent.replace(label, "").trim();
        if (txt) return txt;
      }
    }
    return "";
  };

  return {
    agence         : extract("الوكالة")                      || extract("Agence"),
    nomEntreprise  : extract("الاسم أو العنوان التجاري")     || extract("Raison sociale"),
    secteur        : extract("قطاع النشاط")                  || extract("Secteur"),
    adresse        : extract("العنوان")                       || extract("Adresse"),
    telephone      : extract("الهاتف")                       || extract("Téléphone"),
    cnssEmployeur  : extract("رقم الانخراط في الصندوق الوطني للضمان الاجتماعي"),
    rc             : extract("القيد في السجل التجاري"),
    formeJuridique : extract("النظام القانوني")              || extract("Forme juridique"),
    nomAgent       : extract("الاسم العائلي والشخصي")        || extract("Nom"),
    nationalite    : extract("الجنسية")                      || extract("Nationalité"),
    noCnssAgent    : extract("رقم التسجيل بالصندوق الوطني للضمان الاجتماعي"),
    niveauScolaire : extract("المستوى التعليمي")             || extract("Niveau"),
    poste          : extract("تعيينة")                       || extract("Poste"),
    duree          : extract("لمدة")                         || extract("Durée"),
    salaire        : extract("منحة مالية")                   || extract("Salaire"),
  };
}

// ==========================
// 📊 CRÉATION ITEM MONDAY
// ==========================

async function createMondayItem(data) {

  const itemName = `${data.refContrat} - ${data.cin}`.replace(/"/g, "'");

  const columnValues = {
    texte_ref_contrat    : data.refContrat      || "",
    texte_etat           : data.etatAnapec      || "",
    texte_type           : data.typeContrat     || "",
    date_signature       : formatDate(data.dateSignature),
    date_fin             : formatDate(data.dateFin),
    texte_agence         : data.agence          || "",
    texte_entreprise     : data.nomEntreprise   || "",
    texte_secteur        : data.secteur         || "",
    texte_adresse        : data.adresse         || "",
    phone                : { phone: data.telephone || "", countryShortName: "MA" },
    texte_cnss_emp       : data.cnssEmployeur   || "",
    texte_rc             : data.rc              || "",
    texte_forme_jur      : data.formeJuridique  || "",
    texte_nom_agent      : data.nomAgent        || "",
    texte_nationalite    : data.nationalite     || "",
    texte_cin            : data.cin             || "",
    texte_cnss_agent     : data.noCnssAgent     || "",
    texte_niveau         : data.niveauScolaire  || "",
    texte_poste          : data.poste           || "",
    texte_duree          : data.duree           || "",
    texte_salaire        : data.salaire         || "",
    texte_traitement_cnss: data.traitementCnss  || "",
    email_societe        : { email: data.emailSociete || "", text: data.emailSociete || "" },
    texte_nom_societe    : data.nomSociete      || "",
    statut               : { label: data.etatAnapec || "Projet" },
  };

  const query = `
    mutation {
      create_item (
        board_id: ${MONDAY_BOARD_ID},
        item_name: "${itemName}",
        column_values: ${JSON.stringify(JSON.stringify(columnValues))}
      ) { id }
    }
  `;

  const resp   = await fetch(MONDAY_API_URL, {
    method : "POST",
    headers: {
      "Content-Type" : "application/json",
      "Authorization": MONDAY_API_KEY,
      "API-Version"  : "2023-10",
    },
    body: JSON.stringify({ query }),
  });

  const result = await resp.json();
  if (result.errors) throw new Error("Monday error: " + JSON.stringify(result.errors));
  return result.data.create_item.id;
}

// ==========================
// 🌐 UTILITAIRES HTTP
// ==========================

function httpGet(url, cookies = "") {
  return new Promise((resolve, reject) => {
    const lib     = url.startsWith("https") ? https : http;
    const options = { headers: { Cookie: cookies, "User-Agent": "Mozilla/5.0" } };
    lib.get(url, options, (res) => {
      let body = "";
      if (res.statusCode === 301 || res.statusCode === 302) {
        const loc = res.headers.location;
        const next = loc.startsWith("http") ? loc : `${ANAPEC_BASE_URL}${loc}`;
        return resolve(httpGet(next, cookies));
      }
      res.on("data", c => body += c);
      res.on("end",  () => resolve({ body, headers: res.headers, status: res.statusCode }));
    }).on("error", reject);
  });
}

function httpPost(url, data, cookies = "") {
  return new Promise((resolve, reject) => {
    const parsed  = new URL(url);
    const options = {
      hostname: parsed.hostname,
      path    : parsed.pathname + parsed.search,
      method  : "POST",
      headers : {
        "Content-Type"  : "application/x-www-form-urlencoded",
        "Content-Length": Buffer.byteLength(data),
        "Cookie"        : cookies,
        "User-Agent"    : "Mozilla/5.0",
        "Referer"       : url,
      },
    };
    const lib = url.startsWith("https") ? https : http;
    const req = lib.request(options, (res) => {
      let body = "";
      res.on("data", c => body += c);
      res.on("end",  () => resolve({ body, headers: res.headers, status: res.statusCode }));
    });
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

function formatDate(dateStr) {
  if (!dateStr || dateStr === "---") return "";
  const parts = dateStr.split("/");
  if (parts.length === 3) return `${parts[2]}-${parts[1]}-${parts[0]}`;
  return dateStr;
}
