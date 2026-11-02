// Onaylı HTML taslağının web görünümünü görüntüler (yalnız karşılaştırma için). Kullanım: node ekran_goruntusu.mjs <html> <cikti.png> [sayfa no]
import { chromium } from 'playwright-core';
const [, , dosya, cikti, sayfa] = process.argv;
const t = await chromium.launch({ channel: 'msedge', headless: true });
const p = await (await t.newContext({ viewport: { width: 1320, height: 1000 }, locale: 'tr-TR' })).newPage();
await p.goto('file:///' + dosya.replace(/\\/g, '/'));
await p.getByRole('button', { name: 'Web', exact: true }).first().click().catch(() => {});
if (sayfa) await p.evaluate((n) => window.git?.(Number(n)), sayfa);
await p.waitForTimeout(300);
await p.locator('.tel').first().screenshot({ path: cikti }).catch(async () => p.screenshot({ path: cikti }));
const metin = await p.locator('.ic').first().innerText().catch(() => '');
console.log(metin.slice(0, 2500));
await t.close();
