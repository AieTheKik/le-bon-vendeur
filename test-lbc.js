const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();
  await page.goto('https://www.leboncoin.fr/account/login');
  await page.waitForTimeout(5000);
  const inputs = await page.$$eval('input', els => els.map(e => ({name: e.name, type: e.type, id: e.id, placeholder: e.placeholder})));
  console.log(JSON.stringify(inputs, null, 2));
  await browser.close();
})();
