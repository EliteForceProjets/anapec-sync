// test_duree.mjs
import { readFileSync } from 'fs';

const h = readFileSync('C:\\anapec\\GRUPO_TEYEZ\\ci_1567973.html', 'utf8');
const tag = h.match(/<div[^>]*class=["']printable["'][^>]*>/i);

if (!tag) { console.log('TAG printable NON TROUVE'); process.exit(); }

const idx = h.indexOf(tag[0]);
const raw = h.slice(idx + tag[0].length);
const end = raw.search(/<\/body>/i);
const content = end > 0 ? raw.slice(0, end) : raw;
const text = content
  .replace(/&nbsp;/g, ' ')
  .replace(/<[^>]+>/g, ' ')
  .replace(/[ \t]+/g, ' ');

console.log('Taille texte extrait:', text.length);

// Test regex durée
const m1 = text.match(/لمدة\s+(\d)\s+(\d+)\s+شهر/);
const m2 = text.match(/لمدة\s+(\d+)\s+شهر/);
const m3 = text.match(/\((\d+)\s+شهر[\u0627\u064b]?\s+\u063a\u064a\u0631\s+\u0642\u0627\u0628\u0644\u0629/);
const m4 = text.match(/لمدة.{0,30}شهر/);

console.log('m1 (note+duree):', m1 ? `note=${m1[1]} duree=${m1[2]}` : 'null');
console.log('m2 (direct):', m2 ? m2[1] : 'null');
console.log('m3 (parenthese):', m3 ? m3[1] : 'null');
console.log('m4 (brut):', m4 ? JSON.stringify(m4[0]) : 'null');

// Chercher لمدة dans le texte
const idx2 = text.indexOf('\u0644\u0645\u062f\u0629');
if (idx2 >= 0) {
  console.log('\nContexte لمدة:');
  console.log(JSON.stringify(text.slice(idx2, idx2 + 80)));
  // Afficher les codes char autour
  const chars = text.slice(idx2, idx2 + 20);
  console.log('Codes ASCII:', [...chars].map(c => c.charCodeAt(0).toString(16)).join(' '));
}
