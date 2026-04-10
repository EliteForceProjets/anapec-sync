// ============================================================
// scraper_anapec.mjs - Scraping automatique ANAPEC
// ============================================================

import puppeteer from 'puppeteer';
import { writeFileSync, readFileSync, existsSync, statSync } from 'fs';

const EMAIL    = 'grupoteyez@gmail.com';
const PASSWORD = '123456';
const HOME_URL = 'https://www.anapec.org/sigec-app-rv/';
const BASE_URL = 'https://www.anapec.org/sigec-app-rv/fr/entreprises';
const OUT_DIR  = 'C:\\anapec';
const LOG_FILE = `${OUT_DIR}\\sync_log.txt`;

function log(msg) {
  const line = `[${new Date().toLocaleString('fr-FR')}] ${msg}`;
  console.log(line);
  try {
    const existing = existsSync(LOG_FILE) ? readFileSync(LOG_FILE, 'utf8') : '';
    writeFileSync(LOG_FILE, existing + line + '\n');
  } catch(e) {}
}

async function main() {
  log('=== Début scraping ANAPEC ===');

  const browser = await puppeteer.launch({
    headless: false,  // IMPORTANT: false pour éviter détection bot
    executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--ignore-certificate-errors',
      '--window-size=1400,900',
      '--start-minimized',  // Minimisé = invisible mais fonctionnel
      '--disable-blink-features=AutomationControlled'
    ],
    defaultViewport: { width: 1400, height: 900 }
  });

  try {
    const page = await browser.newPage();
    
    // Masquer les traces de Puppeteer
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    });

    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    // ── 1. Charger page ───────────────────────────────────────
    log('Chargement page ANAPEC...');
    await page.goto(HOME_URL, { waitUntil: 'networkidle2', timeout: 30000 });
    await new Promise(r => setTimeout(r, 4000));

    // Debug inputs
    const allInputs = await page.evaluate(() =>
      [...document.querySelectorAll('input')].map(i => ({
        type: i.type, id: i.id, name: i.name,
        visible: i.getBoundingClientRect().width > 0
      }))
    );
    log('Inputs: ' + JSON.stringify(allInputs.filter(i => i.id)));

    // ── 2. Cliquer radio Employeur ────────────────────────────
    const radioSel = 'input[id="radio_1"], input[value="2"][type="radio"], input[name="rdio"]:last-of-type';
    try {
      await page.waitForSelector(radioSel, { timeout: 5000 });
      await page.click(radioSel);
      log('Radio Employeur cliqué');
    } catch(e) {
      log('Radio non trouvé, tentative JS...');
      await page.evaluate(() => {
        const all = document.querySelectorAll('input[type="radio"]');
        if (all.length >= 2) all[1].click();
      });
    }
    await new Promise(r => setTimeout(r, 2000));

    // Debug après radio
    const afterRadio = await page.evaluate(() =>
      [...document.querySelectorAll('input')].map(i => ({
        type: i.type, id: i.id, name: i.name,
        visible: i.getBoundingClientRect().width > 0
      })).filter(i => i.visible)
    );
    log('Inputs visibles après radio: ' + JSON.stringify(afterRadio));

    // ── 3. Remplir email ──────────────────────────────────────
    const userSel = '#user, input[name="data[cherch_empl][identifiant]"]';
    try {
      await page.waitForSelector(userSel, { visible: true, timeout: 8000 });
      await page.click(userSel, { clickCount: 3 });
      await page.type(userSel, EMAIL, { delay: 50 });
      log('Email tapé');
    } catch(e) {
      log('❌ Email field: ' + e.message);
      await page.screenshot({ path: `${OUT_DIR}\\debug_email.png` });
      return;
    }

    // ── 4. Remplir password ───────────────────────────────────
    const passSel = '#pass, input[name="data[cherch_empl][mot_pass]"]';
    try {
      await page.waitForSelector(passSel, { visible: true, timeout: 5000 });
      await page.click(passSel, { clickCount: 3 });
      await page.type(passSel, PASSWORD, { delay: 50 });
      log('Password tapé');
    } catch(e) {
      log('❌ Password field: ' + e.message);
      return;
    }

    // Screenshot avant soumission
    await page.screenshot({ path: `${OUT_DIR}\\before_submit.png` });
    log('Screenshot: before_submit.png');

    // ── 5. Soumettre ──────────────────────────────────────────
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 20000 }).catch(() => {}),
      page.keyboard.press('Enter')
    ]);

    await new Promise(r => setTimeout(r, 2000));
    log(`URL: ${page.url()}`);

    const isConnected = await page.evaluate(() =>
      document.body.textContent.includes('Déconnexion') ||
      document.body.textContent.includes('Bienvenue') ||
      document.body.textContent.includes('Votre espace')
    );

    if (!isConnected) {
      log('❌ Connexion échouée');
      await page.screenshot({ path: `${OUT_DIR}\\debug_login.png` });
      return;
    }

    log('✅ Connecté !');

    // ── 6. Page contrats ──────────────────────────────────────
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
      writeFileSync(`${OUT_DIR}\\debug_contrats.html`, await page.content(), 'utf8');
      await page.screenshot({ path: `${OUT_DIR}\\debug_contrats.png` });
      log('❌ 0 contrats - debug sauvegardé');
      return;
    }

    const contractsClean = contracts.map(({ detail_id, ...c }) => c);
    writeFileSync(`${OUT_DIR}\\contrats.json`, JSON.stringify(contractsClean, null, 2), 'utf8');
    log('✅ contrats.json sauvegardé');

    // ── 7. Scraper détails ────────────────────────────────────
    let scraped = 0, skipped = 0, errors = 0;

    for (const contract of contracts) {
      const detailId = contract.detail_id || contract.ref.match(/(\d{7,})/)?.[1];
      if (!detailId) continue;

      const outFile = `${OUT_DIR}\\ci_${detailId}.html`;
      if (existsSync(outFile)) {
        const age = (Date.now() - statSync(outFile).mtimeMs) / 3600000;
        if (age < 24) { log(`⏭ ci_${detailId}.html`); skipped++; continue; }
      }

      try {
        await page.goto(`${BASE_URL}/edition_ci/${detailId}`, { waitUntil: 'networkidle2', timeout: 20000 });
        writeFileSync(outFile, await page.content(), 'utf8');
        log(`✅ ci_${detailId}.html`);
        scraped++;
        await new Promise(r => setTimeout(r, 800));
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
