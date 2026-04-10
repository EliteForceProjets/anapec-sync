import { readFileSync } from 'fs';

const html = readFileSync('C:\\anapec\\contrats.html', 'utf8');

console.log('=== TAILLE TOTALE HTML ===');
console.log(html.length + ' caractères\n');

console.log('=== FORMULAIRES ET ACTIONS ===');
const formMatches = html.match(/<form[^>]*>/gi) || [];
formMatches.forEach(f => console.log(f));

console.log('\n=== URLs contenant "contrat" ou "lot" ou "liste" ===');
const urlPattern = /["'](\/[^"']*(?:contrat|lot|liste|search|data|ajax|load)[^"']*)['"]/gi;
let m;
while ((m = urlPattern.exec(html)) !== null) {
  console.log(m[1]);
}

console.log('\n=== TOUS LES SCRIPTS <script src=...> ===');
const scriptSrc = html.match(/<script[^>]+src=["'][^"']+["'][^>]*>/gi) || [];
scriptSrc.forEach(s => console.log(s));

console.log('\n=== RECHERCHE "dataTable" ou "DataTable" ou "ajax" dans scripts inline ===');
const inlineScripts = html.match(/<script[^>]*>([\s\S]*?)<\/script>/gi) || [];
inlineScripts.forEach((script, i) => {
  if (/datatable|ajax|\.load\(|\.post\(|\.get\(|fetch\(/i.test(script)) {
    console.log(`\n--- Script inline #${i} ---`);
    console.log(script.substring(0, 2000));
  }
});

console.log('\n=== COOKIES / SESSION dans la page ===');
const cookiePattern = /(?:JSESSIONID|token|csrf|_token|authenticity)[^"'\s]*/gi;
while ((m = cookiePattern.exec(html)) !== null) {
  console.log(m[0]);
}

console.log('\n=== TOUTES LES URLs /sigec-app ===');
const sigecPattern = /["'](\/sigec-app[^"'?\s]*)['"]/gi;
while ((m = sigecPattern.exec(html)) !== null) {
  console.log(m[1]);
}
