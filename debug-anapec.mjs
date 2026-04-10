process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

import https from "https";
import http from "http";
import { JSDOM } from "jsdom";
import fs from "fs";

const ANAPEC_BASE_URL     = "https://www.anapec.org";
const ANAPEC_LOGIN_URL    = `${ANAPEC_BASE_URL}/sigec-app-rv/fr/entreprises/connexion`;
const ANAPEC_CONTRATS_URL = `${ANAPEC_BASE_URL}/sigec-app-rv/fr/entreprises/visualiser_contrat`;

// ⚠️ METTEZ VOS IDENTIFIANTS ICI
const EMAIL    = "grupoteyez@gmail.com";
const PASSWORD = "123456";

console.log("🔍 DEBUG - Connexion ANAPEC...");

const loginPage = await httpGet(ANAPEC_LOGIN_URL);
const dom       = new JSDOM(loginPage.body);
const csrfInput = dom.window.document.querySelector('input[name="_token"]');
const csrfToken = csrfInput ? csrfInput.value : "";
const setCookie = loginPage.headers["set-cookie"] || [];

console.log("🔑 CSRF token:", csrfToken ? "OK" : "MANQUANT");

const postData = new URLSearchParams({
  _token  : csrfToken,
  email   : EMAIL,
  password: PASSWORD,
}).toString();

const loginResp = await httpPost(ANAPEC_LOGIN_URL, postData, setCookie.join("; "));
const cookies   = loginResp.headers["set-cookie"]?.join("; ") || setCookie.join("; ");

console.log("🔐 Login status:", loginResp.status);
console.log("📍 Redirect:", loginResp.headers["location"] || "aucun");

// Sauvegarder la page de login pour debug
fs.writeFileSync("C:\\anapec\\debug-login.html", loginResp.body);
console.log("💾 Page login sauvegardée: C:\\anapec\\debug-login.html");

// Accéder à la page des contrats
const contratsResp = await httpGet(ANAPEC_CONTRATS_URL, cookies);
console.log("📋 Contrats status:", contratsResp.status);

// Sauvegarder la page des contrats pour debug
fs.writeFileSync("C:\\anapec\\debug-contrats.html", contratsResp.body);
console.log("💾 Page contrats sauvegardée: C:\\anapec\\debug-contrats.html");

// Analyser le HTML
const domContrats = new JSDOM(contratsResp.body);
const tables      = domContrats.window.document.querySelectorAll("table");
const rows        = domContrats.window.document.querySelectorAll("tr");
const title       = domContrats.window.document.querySelector("title")?.textContent;

console.log("\n📊 ANALYSE HTML:");
console.log("   Titre de la page:", title);
console.log("   Nombre de tables:", tables.length);
console.log("   Nombre de lignes tr:", rows.length);
console.log("   Taille HTML:", contratsResp.body.length, "caractères");

// Afficher les 500 premiers caractères du body
console.log("\n📄 Début du HTML:");
console.log(contratsResp.body.substring(0, 500));

// ==========================
// UTILITAIRES HTTP
// ==========================

function httpGet(url, cookies = "") {
  return new Promise((resolve, reject) => {
    const lib     = url.startsWith("https") ? https : http;
    const options = { headers: { Cookie: cookies, "User-Agent": "Mozilla/5.0" } };
    lib.get(url, options, (res) => {
      let body = "";
      if (res.statusCode === 301 || res.statusCode === 302) {
        const loc  = res.headers.location || "";
        const next = loc.startsWith("http") ? loc : `${ANAPEC_BASE_URL}${loc}`;
        console.log("↩️  Redirection vers:", next);
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
