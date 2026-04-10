import { readFileSync } from 'fs';

const html = readFileSync('C:\\anapec\\after_login.html', 'utf8');

console.log('=== TAILLE ===');
console.log(html.length + ' chars');

console.log('\n=== TITLE ===');
const title = html.match(/<title[^>]*>(.*?)<\/title>/i);
console.log(title ? title[1] : 'non trouvé');

console.log('\n=== TOUS LES FORMULAIRES ===');
const forms = html.match(/<form[\s\S]*?<\/form>/gi) || [];
console.log(`Nombre de formulaires: ${forms.length}`);
forms.forEach((f, i) => {
  console.log(`\n--- Formulaire #${i} ---`);
  console.log(f.substring(0, 1000));
});

console.log('\n=== INPUTS TYPE PASSWORD ===');
const passwords = html.match(/<input[^>]*type=["']?password["']?[^>]*>/gi) || [];
passwords.forEach(p => console.log(p));

console.log('\n=== LIENS CONTENANT "login" ou "connexion" ou "authentification" ===');
const links = html.match(/href=["'][^"']*(?:login|connexion|auth|signin|compte)[^"']*["']/gi) || [];
links.forEach(l => console.log(l));

console.log('\n=== URLs sigec dans la page ===');
const sigec = html.match(/https?:\/\/[^"'\s]*sigec[^"'\s]*/gi) || [];
[...new Set(sigec)].forEach(u => console.log(u));

console.log('\n=== PREMIERS 3000 chars du HTML ===');
console.log(html.substring(0, 3000));
