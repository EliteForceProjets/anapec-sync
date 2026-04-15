// ============================================================
// scraper_anapec.mjs - Scraping automatique ANAPEC
// Supporte multi-sociétés via variables d'environnement
// v6 - Fix: restart browser toutes les 50 pages CI + détection session expirée
// ============================================================

import puppeteer from 'puppeteer';
import { writeFileSync, readFileSync, existsSync, statSync, mkdirSync, unlinkSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { readdirSync } from 'fs';

const IS_GITHUB  = process.env.GITHUB_ACTIONS === 'true';
const EMAIL      = process.env.ANAPEC_EMAIL    || 'grupoteyez@gmail.com';
const PASSWORD   = process.env.ANAPEC_PASSWORD || '123456';
const OUT_DIR    = process.env.ANAPEC_OUT_DIR  || (IS_GITHUB ? '.' : 'C:\\anapec');
const HOME_URL   = 'https://www.anapec.org/sigec-app-rv/';
const BASE_URL   = 'https://www.anapec.org/sigec-app-rv/fr/entreprises';
const LOG_FILE   = join(IS_GITHUB ? '.' : 'C:\\anapec', 'sync_log.txt');

// Nombre de fichiers CI téléchargés avant restart browser
const RESTART_EVERY = 40;

// Créer le dossier si inexistant
if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

function log(msg) {
  const line = `[${new Date().toLocaleString('fr-FR')}] ${msg}`;
  console.log(line);
  try {
    const existing = existsSync(LOG_FILE) ? readFileSync(LOG_FILE, 'utf8') : '';
    writeFileSync(LOG_FILE, existing + line + '\n');
  } catch(e) {}
}

// Nettoyer les profils Puppeteer verrouillés dans %TEMP%
function cleanPuppeteerProfiles() {
  if (IS_GITHUB) return;
  try {
    const tmp = tmpdir();
    const dirs = readdirSync(tmp).filter(d => d.startsWith('puppeteer_dev_'));
    for (const dir of dirs) {
      const lockfile = join(tmp, dir, 'lockfile');
      if (existsSync(lockfile)) {
        try { unlinkSync(lockfile); } catch(e) {}
      }
    }
  } catch(e) {}
}

async function launchBrowser() {
  cleanPuppeteerProfiles();
  await new Promise(r => setTimeout(r, 1000)); // laisser OS libérer les handles

  const launchOptions = IS_GITHUB ? {
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--window-size=1400,900'],
    defaultViewport: { width: 1400, height: 900 }
  } : {
    headless: false,
    executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    args: [
      '--no-sandbox', '--disable-setuid-sandbox', '--ignore-certificate-errors',
      '--window-size=1400,900', '--start-minimized',
      '--disable-blink-features=AutomationControlled',
      '--no-first-run', '--no-default-browser-check'
    ],
    defaultViewport: { width: 1400, height: 900 }
  };

  return puppeteer.launch(launchOptions);
}

async function closeBrowser(browser) {
  try { await browser.close(); } catch(e) {}
  await new Promise(r => setTimeout(r, 2000));
  cleanPuppeteerProfiles();
}

async function loginAndGetPage(browser) {
  const page = await browser.newPage();
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

  log('Chargement page ANAPEC...');
  await page.goto(HOME_URL, { waitUntil: 'networkidle2', timeout: 60000 });
  await new Promise(r => setTimeout(r, 4000));

  // Radio Employeur
  try {
    await page.waitForSelector('#radio_1', { timeout: 5000 });
    await page.click('#radio_1');
  } catch(e) {
    await page.evaluate(() => {
      const all = document.querySelectorAll('input[type="radio"]');
      if (all.length >= 2) all[1].click();
    });
  }
  await new Promise(r => setTimeout(r, 2000));

  // Email
  const userSel = '#user, input[name="data[cherch_empl][identifiant]"], input[name="data[Entreprise][identifiant]"]';
  await page.waitForSelector(userSel, { visible: true, timeout: 10000 });
  await page.click(userSel, { clickCount: 3 });
  await page.type(userSel, EMAIL, { delay: 50 });

  // Password
  const passSel = '#pass, input[name="data[cherch_empl][mot_pass]"], input[name="data[Entreprise][mot_pass]"]';
  await page.waitForSelector(passSel, { visible: true, timeout: 5000 });
  await page.click(passSel, { clickCount: 3 });
  await page.type(passSel, PASSWORD, { delay: 50 });

  log('Connexion...');
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }).catch(() => {}),
    page.keyboard.press('Enter')
  ]);
  await new Promise(r => setTimeout(r, 3000));

  const isConnected = await page.evaluate(() =>
    document.body.textContent.includes('Déconnexion') ||
    document.body.textContent.includes('Bienvenue') ||
    document.body.textContent.includes('Votre espace')
  );

  if (!isConnected) {
    log('❌ Connexion échouée');
    writeFileSync(join(OUT_DIR, 'debug_login.html'), await page.content(), 'utf8');
    throw new Error('Connexion échouée');
  }
  log('✅ Connecté !');
  return page;
}

// Vérifier si la session est toujours active (pas de redirect login)
async function isSessionAlive(page) {
  try {
    const url = page.url();
    const bodyText = await page.evaluate(() => document.body.textContent).catch(() => '');
    // Si on est sur la page de login ou si "Déconnexion" a disparu → session morte
    if (url.includes('login') || url === HOME_URL) return false;
    if (bodyText.includes('Session expirée') || bodyText.includes('Veuillez vous connecter')) return false;
    return true;
  } catch(e) {
    return false;
  }
}

async function scrapeCiPage(page, detailId, outFile) {
  // Vérifier session avant chaque téléchargement
  const alive = await isSessionAlive(page);
  if (!alive) throw new Error('SESSION_EXPIRED');

  await page.goto(`${BASE_URL}/edition_ci/${detailId}`, {
    waitUntil: 'networkidle2',
    timeout: 30000
  });

  // Détecter redirect vers login immédiatement
  const currentUrl = page.url();
  if (currentUrl.includes('login') || currentUrl === HOME_URL || !currentUrl.includes('edition_ci')) {
    throw new Error('SESSION_EXPIRED');
  }

  // Attendre chargement AJAX du contenu
  try {
    await page.waitForFunction(
      () => {
        const el = document.querySelector('.printable, .arriereprintable');
        return el && el.innerHTML && el.innerHTML.length > 2000;
      },
      { timeout: 30000 }
    );
  } catch(e) {
    // Timeout → sauvegarder quand même et vérifier taille
    await new Promise(r => setTimeout(r, 2000));
  }

  const htmlContent = await page.content();

  // Deuxième vérification session (parfois redirect silencieux)
  if (htmlContent.includes('data[Entreprise][identifiant]') || htmlContent.length < 5000) {
    throw new Error('SESSION_EXPIRED');
  }

  writeFileSync(outFile, htmlContent, 'utf8');

  if (htmlContent.length < 25000) {
    log(`⚠ ci_${detailId}.html (${htmlContent.length} bytes — contenu potentiellement incomplet)`);
  } else {
    log(`✅ ci_${detailId}.html`);
  }

  return htmlContent.length;
}

async function main() {
  log(`=== Scraping ANAPEC: ${EMAIL} → ${OUT_DIR} ===`);

  // Phase 1 : Récupérer la liste des contrats
  let browser = await launchBrowser();
  let page;

  try {
    page = await loginAndGetPage(browser);
  } catch(e) {
    await closeBrowser(browser);
    process.exit(1);
  }

  // Page contrats — PAGINATION ROBUSTE
  await page.goto(`${BASE_URL}/visualiser_contrat`, { waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise(r => setTimeout(r, 2000));
  await page.waitForSelector('table', { timeout: 15000 }).catch(() => {});

  const allContracts = [];
  const seenRefs = new Set();
  let currentPage = 1;

  const extractPageContracts = () => page.evaluate(() => {
    const rows = document.querySelectorAll('table tr');
    const result = [];
    rows.forEach(row => {
      const cells = row.querySelectorAll('td');
      if (cells.length < 6) return;
      const ref = cells[0]?.innerText?.trim();
      if (!ref || ref.length < 5) return;
      let detailId = '';
      row.querySelectorAll('a').forEach(link => {
        const m = (link.getAttribute('href')||'').match(/edition_ci\/(\d+)/);
        if (m) detailId = m[1];
      });
      result.push({
        ref:       cells[0]?.innerText?.trim() || '',
        date_sig:  cells[1]?.innerText?.trim() || '',
        date_fin:  cells[2]?.innerText?.trim() || '',
        etat:      cells[3]?.innerText?.trim() || '',
        type:      cells[4]?.innerText?.trim() || '',
        cin:       cells[5]?.innerText?.trim() || '',
        detail_id: detailId
      });
    });
    return result;
  });

  const hasSuivant = () => page.evaluate(() => {
    const links = Array.from(document.querySelectorAll('a, span, li'));
    return links.some(el => {
      const text = el.innerText?.trim();
      return text === 'Suivant' || text === '›' || text === 'suivant';
    });
  });

  while (true) {
    const pageContracts = await extractPageContracts();

    if (pageContracts.length === 0) {
      log(`  ⛔ Page ${currentPage}: aucun contrat → arrêt`);
      break;
    }

    const newContracts = pageContracts.filter(c => !seenRefs.has(c.ref));
    if (newContracts.length === 0) {
      log(`  ⛔ Page ${currentPage}: doublons → fin réelle de pagination`);
      break;
    }

    newContracts.forEach(c => seenRefs.add(c.ref));
    allContracts.push(...newContracts);

    const next = await hasSuivant();
    log(`  📄 Page ${currentPage}: +${newContracts.length} contrats (total: ${allContracts.length}) ${next ? '→ suite' : '→ dernière page'}`);

    if (!next) break;

    currentPage++;
    await page.goto(`${BASE_URL}/visualiser_contrat/page:${currentPage}`,
      { waitUntil: 'networkidle2', timeout: 30000 });
    await new Promise(r => setTimeout(r, 1500));
  }

  const contracts = allContracts;
  log(`${contracts.length} contrats trouvés (${currentPage} pages)`);

  if (contracts.length === 0) {
    writeFileSync(join(OUT_DIR, 'debug_contrats.html'), await page.content(), 'utf8');
    log('❌ 0 contrats');
    await closeBrowser(browser);
    process.exit(1);
  }

  const contractsClean = contracts.map(({ detail_id, ...c }) => c);
  writeFileSync(join(OUT_DIR, 'contrats.json'), JSON.stringify(contractsClean, null, 2), 'utf8');
  log('✅ contrats.json sauvegardé');

  // Phase 2 : Télécharger les fiches CI
  // On redémarre le browser tous les RESTART_EVERY téléchargements pour éviter les crashes
  let scraped = 0, skipped = 0, errors = 0;
  let downloadCount = 0; // compteur depuis dernier restart

  for (let i = 0; i < contracts.length; i++) {
    const contract = contracts[i];
    const detailId = contract.detail_id || contract.ref.match(/(\d{7,})/)?.[1];
    if (!detailId) continue;

    const outFile = join(OUT_DIR, `ci_${detailId}.html`);

    // Vérifier si fichier valide existant
    if (existsSync(outFile)) {
      const age = (Date.now() - statSync(outFile).mtimeMs) / 3600000;
      const size = statSync(outFile).size;
      if (age < 168 && size >= 25000) {
        log(`⏭ ci_${detailId}.html`);
        skipped++;
        continue;
      }
      if (size < 25000) log(`♻ ci_${detailId}.html (${size} bytes trop petit → re-téléchargement)`);
    }

    // Restart browser preventif tous les RESTART_EVERY téléchargements
    if (downloadCount > 0 && downloadCount % RESTART_EVERY === 0) {
      log(`🔄 Restart browser préventif (${downloadCount} téléchargements effectués)...`);
      await closeBrowser(browser);
      await new Promise(r => setTimeout(r, 3000));
      browser = await launchBrowser();
      try {
        page = await loginAndGetPage(browser);
      } catch(e) {
        log(`❌ Échec reconnexion après restart: ${e.message}`);
        await closeBrowser(browser);
        process.exit(1);
      }
    }

    // Tentative de téléchargement avec retry si session expirée
    let attempts = 0;
    const maxAttempts = 2;

    while (attempts < maxAttempts) {
      try {
        await scrapeCiPage(page, detailId, outFile);
        scraped++;
        downloadCount++;
        await new Promise(r => setTimeout(r, 600));
        break; // succès
      } catch(e) {
        attempts++;

        if (e.message === 'SESSION_EXPIRED') {
          log(`🔄 Session expirée — reconnexion (tentative ${attempts}/${maxAttempts})...`);
          await closeBrowser(browser);
          await new Promise(r => setTimeout(r, 3000));
          browser = await launchBrowser();
          try {
            page = await loginAndGetPage(browser);
            downloadCount = 0; // reset compteur après reconnexion
          } catch(loginErr) {
            log(`❌ Échec reconnexion: ${loginErr.message}`);
            errors++;
            break;
          }
        } else {
          log(`❌ ${detailId}: ${e.message}`);
          errors++;
          break;
        }
      }
    }

    if (attempts >= maxAttempts) {
      log(`❌ ${detailId}: max tentatives atteint`);
      errors++;
    }
  }

  log(`=== Terminé: ${scraped} nouveaux, ${skipped} existants, ${errors} erreurs ===`);
  await closeBrowser(browser);
}

main().catch(async e => {
  log(`ERREUR CRITIQUE: ${e.message}`);
  process.exit(1);
});
