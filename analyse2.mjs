import fs from "fs";

const c = fs.readFileSync("C:\\anapec\\contrats.html", "utf8");

// Chercher les appels AJAX
console.log("=== AJAX URLs ===");
const ajax = c.match(/url\s*[:=]\s*['"][^'"]+['"]/g) || [];
ajax.forEach(l => console.log(l));

// Chercher $.ajax ou $.post
console.log("\n=== jQuery calls ===");
const jq = c.match(/\$\.(ajax|post|get)\s*\([^)]{0,100}/g) || [];
jq.forEach(l => console.log(l));

// Chercher les scripts inline
console.log("\n=== Scripts inline ===");
const scripts = c.match(/<script[^>]*>([\s\S]*?)<\/script>/g) || [];
scripts.forEach((s, i) => {
  if (s.includes("ajax") || s.includes("post") || s.includes("contrat") || s.includes("cherch")) {
    console.log("Script " + i + ":");
    console.log(s.substring(0, 500));
    console.log("---");
  }
});

// Chercher la table et son contenu
console.log("\n=== TABLE HTML ===");
const table = c.match(/<table[\s\S]*?<\/table>/g) || [];
table.forEach((t, i) => {
  console.log("Table " + i + " (" + t.length + " chars):");
  console.log(t.substring(0, 300));
  console.log("---");
});
