process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

import https from "https";
import http from "http";
import { JSDOM } from "jsdom";

const MONDAY_API_KEY  = "eyJhbGciOiJIUzI1NiJ9.eyJ0aWQiOjQ0MjgwOTc1MCwiYWFpIjoxMSwidWxkIjo0MDc5NzY3NywiaWFkIjoiMjAyNC0xMS0yOVQyMDo0MzozNS4wMDBaIiwicGVyIjoibWU6d3JpdGUiLCJhY3RpZCI6MTU1OTc4MTUsInJnbiI6ImV1YzEifQ.kDaFO4cuWLy4Q4PbCe7mLuAGvbRRZAshbvuRG-b3b6U";
const MONDAY_BOARD_ID = "5094200598";

const SOCIETES = [
  { email: "grupoteyez@gmail.com", password: "123456", nom: "GRUPO TEYEZ" },
];

const MONDAY_API_URL      = "https://api.monday.com/v2";
const ANAPEC_HOST         = "www.anapec.org";
const ANAPEC_BASE         = "https://www.anapec.org";
const ANAPEC_LOGIN_URL    = "/sigec-app-rv/fr/entreprises/login";
const ANAPEC_CONTRATS_URL = "/sigec-app-rv/fr/entreprises/visualiser_contrat";

console.log("DEBUT - ANAPEC vers Monday.com");
console.log(SOCIETES.length + " societe(s) a traiter\n");

let totalContrats = 0;

for (const societe of SOCIETES) {
  console.log("\nTraitement: " + societe.email + " (" + societe.nom + ")");
  try {
    const jar = await loginAnapec(societe.email, societe.password);
    console.log("Connecte a ANAPEC OK - cookies: " + Object.keys(jar).join(","));
    const contrats = await getListeContrats(jar);
    console.log(contrats.length + " contrat(s) trouve(s)");
    for (const contrat of contrats) {
      console.log("Contrat: " + contrat.refContrat);
      const detail  = await getDetailContrat(jar, contrat.urlPath);
      const donnees = Object.assign({}, contrat, detail, { emailSociete: societe.email, nomSociete: societe.nom });
      const itemId  = await createMondayItem(donnees);
      console.log("Cree dans Monday - ID: " + itemId);
      totalContrats++;
    }
  } catch (err) {
    console.error("Erreur: " + err.message);
    console.error(err.stack);
  }
}

console.log("\nTERMINE - " + totalContrats + " contrat(s) transfere(s) dans Monday");

// ==========================
// LOGIN ANAPEC
// ==========================
async function loginAnapec(email, password) {
  let jar = {};

  // Etape 1 : GET page login pour cookies initiaux
  const r1 = await anapecGet(ANAPEC_LOGIN_URL, jar);
  console.log("   GET login: " + r1.status + " cookies: " + Object.keys(jar).join(","));

  // Etape 2 : POST identifiants
  const postData = "data%5Bcherch_empl%5D%5Bidentifiant%5D=" + encodeURIComponent(email) +
                   "&data%5Bcherch_empl%5D%5Bmot_pass%5D=" + encodeURIComponent(password);

  const r2 = await anapecPost(ANAPEC_LOGIN_URL, postData, jar);
  console.log("   POST login: " + r2.status + " location: " + (r2.location || "none"));
  console.log("   Cookies POST: " + Object.keys(jar).join(","));

  // Etape 3 : suivre toutes les redirections
  let redirectUrl = r2.location;
  let count = 0;
  while (redirectUrl && count < 5) {
    const path = redirectUrl.startsWith("http") ? new URL(redirectUrl).pathname : redirectUrl;
    const r3 = await anapecGet(path, jar);
    console.log("   Redirect " + (count+1) + ": " + path + " -> " + r3.status);
    redirectUrl = r3.location;
    count++;
  }

  // Etape 4 : tester acces page contrats
  const r4 = await anapecGet(ANAPEC_CONTRATS_URL, jar);
  console.log("   Test contrats: " + r4.status + " size: " + r4.body.length);

  if (r4.status !== 200 || r4.body.length < 20000) {
    // Sauvegarder pour debug
    require("fs").writeFileSync("C:\\anapec\\debug-session.html", r4.body);
    throw new Error("Acces contrats echoue (size=" + r4.body.length + ") - debug dans C:\\anapec\\debug-session.html");
  }

  return jar;
}

// ==========================
// LISTE DES CONTRATS
// ==========================
async function getListeContrats(jar) {
  const r = await anapecGet(ANAPEC_CONTRATS_URL, jar);
  const dom = new JSDOM(r.body);
  const doc = dom.window.document;
  const rows = Array.from(doc.querySelectorAll("table tr")).filter(function(row) {
    return row.querySelectorAll("td").length >= 3;
  });
  console.log("   Lignes: " + rows.length + " tables: " + doc.querySelectorAll("table").length);
  return rows.map(function(row) {
    const cells = row.querySelectorAll("td");
    const lien  = row.querySelector('a[href*="edition_ci"]');
    return {
      refContrat    : cells[0] ? cells[0].textContent.trim() : "",
      dateSignature : cells[1] ? cells[1].textContent.trim() : "",
      dateFin       : cells[2] ? cells[2].textContent.trim() : "",
      etatAnapec    : cells[3] ? cells[3].textContent.trim() : "",
      typeContrat   : cells[4] ? cells[4].textContent.trim() : "",
      cin           : cells[5] ? cells[5].textContent.trim() : "",
      traitementCnss: cells[6] ? cells[6].textContent.trim() : "",
      urlPath       : lien ? lien.getAttribute("href") : "",
    };
  }).filter(function(c) { return c.refContrat && c.refContrat.startsWith("A"); });
}

// ==========================
// DETAIL D'UN CONTRAT
// ==========================
async function getDetailContrat(jar, urlPath) {
  if (!urlPath) return {};
  const r   = await anapecGet(urlPath, jar);
  const doc = new JSDOM(r.body).window.document;

  function extract(label) {
    const els = doc.querySelectorAll("td");
    for (let i = 0; i < els.length; i++) {
      if (els[i].textContent.trim() === label && els[i+1]) {
        return els[i+1].textContent.trim();
      }
    }
    return "";
  }

  function extractContains(label) {
    const els = doc.querySelectorAll("td");
    for (let i = 0; i < els.length; i++) {
      if (els[i].textContent.trim().includes(label) && els[i+1]) {
        return els[i+1].textContent.trim();
      }
    }
    return "";
  }

  return {
    agence        : extract("\u0627\u0644\u0648\u0643\u0627\u0644\u0629"),
    nomEntreprise : extractContains("\u0627\u0644\u0627\u0633\u0645 \u0623\u0648 \u0627\u0644\u0639\u0646\u0648\u0627\u0646"),
    secteur       : extractContains("\u0642\u0637\u0627\u0639 \u0627\u0644\u0646\u0634\u0627\u0637"),
    adresse       : extract("\u0627\u0644\u0639\u0646\u0648\u0627\u0646"),
    telephone     : extract("\u0627\u0644\u0647\u0627\u062a\u0641"),
    cnssEmployeur : extractContains("\u0631\u0642\u0645 \u0627\u0644\u0627\u0646\u062e\u0631\u0627\u0637"),
    rc            : extractContains("\u0627\u0644\u0633\u062c\u0644 \u0627\u0644\u062a\u062c\u0627\u0631\u064a"),
    formeJuridique: extract("\u0627\u0644\u0646\u0638\u0627\u0645 \u0627\u0644\u0642\u0627\u0646\u0648\u0646\u064a"),
    nomAgent      : extractContains("\u0627\u0644\u0627\u0633\u0645 \u0627\u0644\u0639\u0627\u0626\u0644\u064a"),
    nationalite   : extract("\u0627\u0644\u062c\u0646\u0633\u064a\u0629"),
    noCnssAgent   : extractContains("\u0631\u0642\u0645 \u0627\u0644\u062a\u0633\u062c\u064a\u0644"),
    niveauScolaire: extractContains("\u0627\u0644\u0645\u0633\u062a\u0648\u0649 \u0627\u0644\u062a\u0639\u0644\u064a\u0645\u064a"),
    poste         : extract("\u062a\u0639\u064a\u064a\u0646\u0629"),
    duree         : extractContains("\u0644\u0645\u062f\u0629"),
    salaire       : extractContains("\u0645\u0646\u062d\u0629"),
  };
}

// ==========================
// CREATION ITEM MONDAY
// ==========================
async function createMondayItem(data) {
  const itemName = (data.refContrat + " - " + data.cin).replace(/"/g, "'");
  const cv = {
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
  const query = "mutation { create_item (board_id: " + MONDAY_BOARD_ID + ", item_name: \"" + itemName + "\", column_values: " + JSON.stringify(JSON.stringify(cv)) + ") { id } }";
  const resp = await fetch(MONDAY_API_URL, {
    method : "POST",
    headers: { "Content-Type": "application/json", "Authorization": MONDAY_API_KEY, "API-Version": "2023-10" },
    body   : JSON.stringify({ query }),
  });
  const result = await resp.json();
  if (result.errors) throw new Error("Monday: " + JSON.stringify(result.errors));
  return result.data.create_item.id;
}

// ==========================
// HTTP HELPERS (path seulement, host = anapec)
// ==========================
function anapecGet(path, jar) {
  return new Promise(function(resolve, reject) {
    const req = https.request({
      hostname: ANAPEC_HOST,
      port    : 443,
      path    : path,
      method  : "GET",
      headers : {
        "Cookie"         : cookieStr(jar),
        "User-Agent"     : "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120",
        "Accept"         : "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8",
        "Accept-Encoding": "identity",
        "Connection"     : "keep-alive",
        "Referer"        : ANAPEC_BASE + path,
      }
    }, function(res) {
      mergeCookies(jar, parseCookies(res.headers));
      const location = res.headers["location"] || "";
      if (res.statusCode === 301 || res.statusCode === 302) {
        res.resume();
        return resolve({ status: res.statusCode, body: "", location: location });
      }
      let body = "";
      res.on("data", function(c) { body += c; });
      res.on("end",  function()  { resolve({ status: res.statusCode, body: body, location: "" }); });
    });
    req.on("error", reject);
    req.end();
  });
}

function anapecPost(path, data, jar) {
  return new Promise(function(resolve, reject) {
    const req = https.request({
      hostname: ANAPEC_HOST,
      port    : 443,
      path    : path,
      method  : "POST",
      headers : {
        "Content-Type"   : "application/x-www-form-urlencoded",
        "Content-Length" : Buffer.byteLength(data),
        "Cookie"         : cookieStr(jar),
        "User-Agent"     : "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120",
        "Accept"         : "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8",
        "Accept-Encoding": "identity",
        "Referer"        : ANAPEC_BASE + path,
        "Origin"         : ANAPEC_BASE,
        "Connection"     : "keep-alive",
      }
    }, function(res) {
      mergeCookies(jar, parseCookies(res.headers));
      const location = res.headers["location"] || "";
      let body = "";
      res.on("data", function(c) { body += c; });
      res.on("end",  function()  { resolve({ status: res.statusCode, body: body, location: location }); });
    });
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

function mergeCookies(jar, c) { Object.assign(jar, c); }
function cookieStr(jar) {
  return Object.entries(jar).map(function(e) { return e[0] + "=" + e[1]; }).join("; ");
}
function parseCookies(headers) {
  const r = {}, sc = headers["set-cookie"];
  if (!sc) return r;
  const list = Array.isArray(sc) ? sc : [sc];
  for (const c of list) {
    const p = c.split(";")[0].trim();
    const i = p.indexOf("=");
    if (i > 0) r[p.slice(0, i).trim()] = p.slice(i + 1).trim();
  }
  return r;
}
function formatDate(d) {
  if (!d || d === "---") return "";
  const p = d.split("/");
  return p.length === 3 ? p[2] + "-" + p[1] + "-" + p[0] : d;
}
