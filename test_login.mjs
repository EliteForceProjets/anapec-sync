// test_login.mjs - Test connexion HTTP directe ANAPEC
import { writeFileSync, existsSync, readFileSync } from 'fs';

const EMAIL = 'grupoteyez@gmail.com';
const PASSWORD = '123456';

async function test() {
  console.log('Test connexion HTTP directe ANAPEC...');

  // Étape 1 : récupérer le cookie de session
  const r1 = await fetch('https://www.anapec.org/sigec-app-rv/', {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': 'text/html,application/xhtml+xml'
    }
  });
  
  const cookies1 = r1.headers.get('set-cookie') || '';
  console.log('Cookie initial:', cookies1.substring(0, 100));
  
  // Extraire PHPSESSID ou autre cookie de session
  const sessionMatch = cookies1.match(/([A-Za-z_]+=[^;]+)/);
  const sessionCookie = sessionMatch ? sessionMatch[1] : '';
  console.log('Session cookie:', sessionCookie);

  // Étape 2 : POST connexion
  const body = new URLSearchParams({
    'data[cherch_empl][identifiant]': EMAIL,
    'data[cherch_empl][mot_pass]': PASSWORD,
    'data[User][remember_me]': '0',
    'rdio': 'radio_1'
  }).toString();

  console.log('Body POST:', body);

  const r2 = await fetch('https://www.anapec.org/sigec-app-rv/fr/entreprises/connexion', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Referer': 'https://www.anapec.org/sigec-app-rv/',
      'Cookie': sessionCookie
    },
    body,
    redirect: 'manual'
  });

  console.log('Status POST:', r2.status);
  console.log('Location:', r2.headers.get('location'));
  console.log('Set-Cookie:', r2.headers.get('set-cookie')?.substring(0, 200));
  
  const html = await r2.text();
  console.log('Réponse (500 chars):', html.substring(0, 500));
  
  writeFileSync('C:\\anapec\\test_login_result.html', html);
  console.log('Réponse sauvegardée dans test_login_result.html');
}

test().catch(e => console.error('Erreur:', e.message));
