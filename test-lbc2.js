const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();
  await page.goto('https://www.leboncoin.fr/account/login');
  await page.waitForTimeout(8000);
  const inputs = await page.$$eval('input', els => els.map(e => ({name: e.name, type: e.type, id: e.id, placeholder: e.placeholder})));
  console.log('Inputs:', JSON.stringify(inputs, null, 2));
  const iframes = await page.$$eval('iframe', els => els.map(e => ({src: e.src, id: e.id})));
  console.log('Iframes:', JSON.stringify(iframes, null, 2));
  const url = page.url();
  console.log('URL:', url);
  await browser.close();
})();
