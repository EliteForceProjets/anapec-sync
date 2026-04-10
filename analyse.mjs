import fs from "fs";

const c = fs.readFileSync("C:\\anapec\\contrats.html", "utf8");
const t = c.match(/<title>(.*?)<\/title>/);
console.log("Title:", t ? t[1] : "none");
console.log("Size:", c.length);

// Chercher les formulaires
const forms = c.match(/<form[^>]*action="([^"]*)"[^>]*>/g) || [];
console.log("\nFormulaires:");
forms.forEach(f => console.log(" ", f.substring(0, 100)));

// Chercher les liens de menu
const menuLinks = c.match(/href="([^"]*entreprises[^"]*)"[^>]*>/g) || [];
console.log("\nLiens entreprises:");
menuLinks.slice(0, 15).forEach(l => console.log(" ", l));

// Chercher visualiser
const visu = c.match(/href="([^"]*visualiser[^"]*)"[^>]*>/g) || [];
console.log("\nLiens visualiser:");
visu.forEach(l => console.log(" ", l));

// Chercher contrat
const contrat = c.match(/href="([^"]*contrat[^"]*)"[^>]*>/g) || [];
console.log("\nLiens contrat:");
contrat.slice(0, 10).forEach(l => console.log(" ", l));

// Debut du body
const body = c.indexOf("<body");
console.log("\nDebut body:");
console.log(c.substring(body, body + 500));
