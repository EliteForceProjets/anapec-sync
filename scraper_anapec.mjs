// ============================================================
// scraper_anapec.mjs - Scraping automatique ANAPEC
// Supporte multi-sociétés via variables d'environnement
// ============================================================

import puppeteer from 'puppeteer';
import { writeFileSync, readFileSync, existsSync, statSync, mkdirSync } from 'fs';
import { join } from 'path';

const IS_GITHUB  = process.env.GITHUB_ACTIONS === 'true';
const EMAIL      = process.env.ANAPEC_EMAIL    || 'grupoteyez@gmail.com';
const PASSWORD   = process.env.ANAPEC_PASSWORD || '123456';
const OUT_DIR    = process.env.ANAPEC_OUT_DIR  || (IS_GITHUB ? '.' : 'C:\\anapec');
const HOME_URL   = 'https://www.anapec.org/sigec-app-rv/';
const BASE_URL   = 'https://www.anapec.org/sigec-app-rv/fr/entreprises';
const LOG_FILE   = join(IS_GITHUB ? '.' : 'C:\\anapec', 'sync_log.txt');

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

async function main() {
  log(`=== Scraping ANAPEC: ${EMAIL} → ${OUT_DIR} ===`);

  const launchOptions = IS_GITHUB ? {
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--window-size=1400,900'],
    defaultViewport: { width: 1400, height: 900 }
  } : {
    headless: false,
    executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--ignore-certificate-errors', '--window-size=1400,900', '--start-minimized', '--disable-blink-features=AutomationControlled'],
    defaultViewport: { width: 1400, height: 900 }
  };

  const browser = await puppeteer.launch(launchOptions);

  try {
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
      process.exit(1);
    }
    log('✅ Connecté !');

    // Page contrats
    await page.goto(`${BASE_URL}/visualiser_contrat`, { waitUntil: 'networkidle2', timeout: 30000 });
    await new Promise(r => setTimeout(r, 2000));
    await page.waitForSelector('table', { timeout: 15000 }).catch(() => {});

    const contracts = await page.evaluate(() => {
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

    log(`${contracts.length} contrats trouvés`);

    if (contracts.length === 0) {
      writeFileSync(join(OUT_DIR, 'debug_contrats.html'), await page.content(), 'utf8');
      log('❌ 0 contrats');
      process.exit(1);
    }

    const contractsClean = contracts.map(({ detail_id, ...c }) => c);
    writeFileSync(join(OUT_DIR, 'contrats.json'), JSON.stringify(contractsClean, null, 2), 'utf8');
    log('✅ contrats.json sauvegardé');

    // Scraper détails
    let scraped = 0, skipped = 0, errors = 0;
    for (const contract of contracts) {
      const detailId = contract.detail_id || contract.ref.match(/(\d{7,})/)?.[1];
      if (!detailId) continue;

      const outFile = join(OUT_DIR, `ci_${detailId}.html`);
      if (existsSync(outFile)) {
        const age = (Date.now() - statSync(outFile).mtimeMs) / 3600000;
        if (age < 168) { log(`⏭ ci_${detailId}.html`); skipped++; continue; }
      }

      try {
        await page.goto(`${BASE_URL}/edition_ci/${detailId}`, { waitUntil: 'networkidle2', timeout: 20000 });
        writeFileSync(outFile, await page.evaluate(() => document.body.innerText), 'utf8');
        log(`✅ ci_${detailId}.html`);
        scraped++;
        await new Promise(r => setTimeout(r, 1000));
      } catch(e) {
        log(`❌ ${detailId}: ${e.message}`);
        errors++;
      }
    }

    log(`=== Terminé: ${scraped} nouveaux, ${skipped} existants, ${errors} erreurs ===`);

  } finally {
    await browser.close();
  }
}

main().catch(e => {
  log(`ERREUR CRITIQUE: ${e.message}`);
  process.exit(1);
});
