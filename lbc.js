const { chromium } = require('playwright');

async function connecterLBC(email, password) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 800 }
  });
  const page = await context.newPage();

  try {
    // Aller sur la page de connexion LBC
    await page.goto('https://www.leboncoin.fr/account/login', { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);

    // Remplir email
    await page.fill('input[name="email"]', email);
    await page.waitForTimeout(500);

    // Remplir mot de passe
    await page.fill('input[name="password"]', password);
    await page.waitForTimeout(500);

    // Cliquer sur connexion
    await page.click('button[type="submit"]');
    await page.waitForTimeout(3000);

    // Vérifier si connecté
    const url = page.url();
    const cookies = await context.cookies();
    const isConnected = !url.includes('/login') && cookies.length > 0;

    if (isConnected) {
      // Sauvegarder les cookies pour réutilisation
      await browser.close();
      return { success: true, cookies };
    } else {
      await browser.close();
      return { success: false, error: 'Identifiants incorrects' };
    }
  } catch (err) {
    await browser.close();
    return { success: false, error: err.message };
  }
}

async function posterAnnonce(cookies, annonce, prixAffiche, imageBase64) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  });

  // Restaurer la session
  await context.addCookies(cookies);
  const page = await context.newPage();

  try {
    await page.goto('https://www.leboncoin.fr/deposer-une-annonce', { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);

    // TODO: remplir le formulaire d'annonce
    // Cette partie sera développée selon la structure exacte du formulaire LBC

    await browser.close();
    return { success: true };
  } catch (err) {
    await browser.close();
    return { success: false, error: err.message };
  }
}

async function lireMessages(cookies) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  });

  await context.addCookies(cookies);
  const page = await context.newPage();

  try {
    await page.goto('https://www.leboncoin.fr/mes-messages', { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);

    // TODO: extraire les messages non lus

    await browser.close();
    return { success: true, messages: [] };
  } catch (err) {
    await browser.close();
    return { success: false, error: err.message };
  }
}

module.exports = { connecterLBC, posterAnnonce, lireMessages };
