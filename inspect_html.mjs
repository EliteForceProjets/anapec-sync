// inspect_html.mjs - Inspecter la structure du nouveau fichier HTML
import { readFileSync } from 'fs';

const h = readFileSync('C:\\anapec\\GRUPO_TEYEZ\\ci_1567973.html', 'utf8');

console.log('=== TAILLE FICHIER:', h.length, 'chars ===');

// Chercher toutes les classes div
const divClasses = [...h.matchAll(/<div[^>]*class=["'][^"']*["'][^>]*>/gi)]
  .map(m => m[0].substring(0, 80));
console.log('\n=== TOUTES LES CLASSES DIV (max 15):');
divClasses.slice(0, 15).forEach((d, i) => console.log(i, d));

// Chercher "printable" partout
const printIdx = h.toLowerCase().indexOf('printable');
console.log('\n=== "printable" dans le HTML:', printIdx >= 0 ? `trouvé à idx ${printIdx}` : 'ABSENT');
if (printIdx >= 0) {
  console.log('Contexte:', h.slice(printIdx - 20, printIdx + 60));
}

// Chercher لمدة dans le HTML brut
const arabicIdx = h.indexOf('\u0644\u0645\u062f\u0629');
console.log('\n=== "لمدة" dans HTML brut:', arabicIdx >= 0 ? `trouvé à idx ${arabicIdx}` : 'ABSENT');
if (arabicIdx >= 0) {
  console.log('Contexte brut:', JSON.stringify(h.slice(arabicIdx - 10, arabicIdx + 60)));
}

// Chercher le body
const bodyIdx = h.toLowerCase().indexOf('<body');
console.log('\n=== <body> à idx:', bodyIdx);
if (bodyIdx >= 0) {
  // Voir les 5 premiers divs dans le body
  const body = h.slice(bodyIdx);
  const bodyDivs = [...body.matchAll(/<div[^>]*>/gi)].slice(0, 5);
  console.log('5 premiers divs dans body:');
  bodyDivs.forEach((m, i) => console.log(i, m[0].substring(0, 100)));
}

// Chercher les scripts - voir si le texte arabe est dans JS
const scripts = [...h.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)];
console.log('\n=== NOMBRE DE SCRIPTS:', scripts.length);
let foundInScript = false;
for (const s of scripts) {
  if (s[1].includes('\u0644\u0645\u062f\u0629')) {
    console.log('⚠️  لمدة TROUVÉ DANS UN SCRIPT !');
    const idx = s[1].indexOf('\u0644\u0645\u062f\u0629');
    console.log('Contexte script:', JSON.stringify(s[1].slice(Math.max(0,idx-20), idx+60)));
    foundInScript = true;
    break;
  }
}
if (!foundInScript) console.log('لمدة N\'est PAS dans les scripts');
