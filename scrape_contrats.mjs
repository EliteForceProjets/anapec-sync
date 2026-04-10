import { writeFileSync } from 'fs';

// ─── CONFIGURATION ────────────────────────────────────────────
const BASE_URL   = 'https://anapec.ma/sigec-app-rv';
const LOGIN_URL  = `${BASE_URL}/fr/entreprises/index`;
const CONTRAT_URL = `${BASE_URL}/fr/entreprises/visualiser_contrat`;

// !! Remplacez par vos vrais identifiants !!
const USERNAME = 'grupoteyez@gmail.com';
const PASSWORD = '123456';
// ──────────────────────────────────────────────────────────────

let cookieJar = '';

function extractCookies(response) {
  const setCookie = response.headers.getSetCookie?.() || [];
  setCookie.forEach(c => {
    const part = c.split(';')[0];
    if (!cookieJar.includes(part.split('=')[0])) {
      cookieJar += (cookieJar ? '; ' : '') + part;
    } else {
      // update existing cookie
      const name = part.split('=')[0];
      cookieJar = cookieJar.replace(new RegExp(name + '=[^;]*'), part);
    }
  });
}

async function fetchWithCookies(url, options = {}) {
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'fr-FR,fr;q=0.9',
    'Cookie': cookieJar,
    ...options.headers
  };
  const res = await fetch(url, { ...options, headers, redirect: 'manual' });
  extractCookies(res);

  // Suivre les redirections manuellement
  if ([301, 302, 303].includes(res.status)) {
    const location = res.headers.get('location');
    const nextUrl = location.startsWith('http') ? location : BASE_URL + location;
    console.log(`  → Redirect vers: ${nextUrl}`);
    return fetchWithCookies(nextUrl, { method: 'GET' });
  }
  return res;
}

async function main() {
  console.log('=== ÉTAPE 1: Chargement page login ===');
  const loginPage = await fetchWithCookies(LOGIN_URL);
  console.log(`Status: ${loginPage.status}`);
  console.log(`Cookies obtenus: ${cookieJar}`);

  const loginHtml = await loginPage.text();

  // Chercher token CSRF si présent
  const csrfMatch = loginHtml.match(/name=["']_token["'][^>]*value=["']([^"']+)["']/i)
                  || loginHtml.match(/name=["']csrf[^"']*["'][^>]*value=["']([^"']+)["']/i);
  const csrfToken = csrfMatch ? csrfMatch[1] : null;
  console.log(`CSRF token: ${csrfToken || 'non trouvé'}`);

  // Chercher le formulaire de login
  const formAction = loginHtml.match(/<form[^>]*action=["']([^"']*(?:login|auth|connexion|index)[^"']*)["']/i);
  console.log(`Form action: ${formAction ? formAction[1] : 'non trouvé'}`);

  console.log('\n=== ÉTAPE 2: Envoi des identifiants ===');
  const formData = new URLSearchParams();
  formData.append('username', USERNAME);
  formData.append('password', PASSWORD);
  if (csrfToken) formData.append('_token', csrfToken);

  // Essayer plusieurs noms de champs courants
  formData.append('login', USERNAME);
  formData.append('passwd', PASSWORD);
  formData.append('cin', USERNAME);
  formData.append('mot_de_passe', PASSWORD);

  const postUrl = formAction
    ? (formAction[1].startsWith('http') ? formAction[1] : BASE_URL + formAction[1])
    : LOGIN_URL;

  const loginRes = await fetchWithCookies(postUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: formData.toString()
  });

  console.log(`Status après login: ${loginRes.status}`);
  console.log(`Cookies après login: ${cookieJar}`);

  const afterLoginHtml = await loginRes.text();
  writeFileSync('C:\\anapec\\after_login.html', afterLoginHtml);
  console.log(`Page après login sauvegardée (${afterLoginHtml.length} chars)`);

  // Vérifier si connecté
  const isLoggedIn = afterLoginHtml.includes('logout') || afterLoginHtml.includes('déconnexion');
  console.log(`Connecté: ${isLoggedIn ? 'OUI ✓' : 'NON ✗'}`);

  if (!isLoggedIn) {
    console.log('\n⚠️  Login échoué. Vérifiez vos identifiants dans le script.');
    console.log('Cherchons le bon formulaire de login dans after_login.html...');
    const forms = afterLoginHtml.match(/<form[^>]*>[\s\S]*?<\/form>/gi) || [];
    forms.forEach((f, i) => console.log(`\nFormulaire #${i}:\n`, f.substring(0, 500)));
    return;
  }

  console.log('\n=== ÉTAPE 3: Récupération des contrats ===');
  const contratsRes = await fetchWithCookies(CONTRAT_URL);
  const contratsHtml = await contratsRes.text();
  writeFileSync('C:\\anapec\\contrats_auth.html', contratsHtml);
  console.log(`Page contrats sauvegardée (${contratsHtml.length} chars)`);

  // Parser les lignes du tableau
  const rows = contratsHtml.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) || [];
  console.log(`\nNombre de lignes trouvées: ${rows.length}`);

  const dataRows = rows.filter(r => r.includes('<td'));
  console.log(`Lignes avec données (td): ${dataRows.length}`);

  if (dataRows.length > 0) {
    console.log('\n=== DONNÉES CONTRATS ===');
    dataRows.forEach((row, i) => {
      const cells = row.match(/<td[^>]*>([\s\S]*?)<\/td>/gi) || [];
      const values = cells.map(c => c.replace(/<[^>]+>/g, '').trim());
      console.log(`Contrat ${i+1}:`, values.join(' | '));
    });
  }
}

main().catch(console.error);
