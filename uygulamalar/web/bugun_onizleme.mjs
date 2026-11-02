// Deneme CEO hesabının Bugün ekranını görüntüye alır; hesabın kurulum ve ilk giriş durumunu önceki haline döndürür. Yalnız sentetik hesap.
import { createDecipheriv, createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { chromium } from 'playwright-core';

const [, , webCikti, telCikti] = process.argv;
const env = Object.fromEntries(readFileSync('C:/YATONET360/.env.local', 'utf8').split(/\r?\n/).filter(Boolean).map((s) => s.split(/=(.*)/s).slice(0, 2)));
const [, ep, parola] = readFileSync('C:/YATONET360/.araclar/deneme_hesaplari.txt', 'utf8').split('\n').map((l) => l.split('\t')).find((s) => s[0] === 'CEO');
const B = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function totp(g, kayma = 0) {
  let bit = 0, d = 0; const c = [];
  for (const h of g) { d = (d << 5) | B.indexOf(h); bit += 5; if (bit >= 8) { c.push((d >>> (bit - 8)) & 255); bit -= 8; } }
  const s = Buffer.alloc(8); s.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000) + kayma));
  const m = createHmac('sha1', Buffer.from(c)).update(s).digest(); const o = m[m.length - 1] & 15;
  return String((m.readUInt32BE(o) & 0x7fffffff) % 1e6).padStart(6, '0');
}
const coz = (p) => { const [iv, t, v] = p.split('.').map((x) => Buffer.from(x, 'base64url')); const d = createDecipheriv('aes-256-gcm', Buffer.from(env.YATONET_SIFRELEME_ANAHTARI, 'hex'), iv); d.setAuthTag(t); return Buffer.concat([d.update(v), d.final()]).toString(); };
const sup = new pg.Client({ host: 'localhost', user: 'postgres', password: env.POSTGRES_SUPER_PAROLA, database: 'yatonet360' });
await sup.connect();
const once = (await sup.query(`SELECT kimlik, totp_gizli_sifreli, totp_son_adim, izin_adimi_zamani FROM kullanici_hesabi WHERE e_posta = $1`, [ep])).rows[0];
const ayd = (await sup.query(`SELECT count(*)::int n FROM aydinlatma_kaydi WHERE ilgili_kisi_ref = $1`, [once.kimlik])).rows[0].n;
const t = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const p = await (await t.newContext({ viewport: { width: 1280, height: 900 }, locale: 'tr-TR' })).newPage();
  await p.goto('http://127.0.0.1:5173/');
  await p.getByLabel('E-Posta veya Cep Telefonu').fill(ep);
  await p.getByLabel('Parola').fill(parola);
  await p.getByRole('button', { name: 'Giriş' }).click();
  await p.locator('.kod input').first().waitFor();
  const kurulu = await p.locator('.kurulum code').isVisible().catch(() => false) || await p.locator('.kurulum code').waitFor({ timeout: 1500 }).then(() => true).catch(() => false);
  const gizli = kurulu ? await p.locator('.kurulum code').textContent() : coz(once.totp_gizli_sifreli);
  await p.locator('.kod input').first().focus();
  await p.keyboard.type(totp(gizli, kurulu ? 0 : 1), { delay: 20 });
  await p.getByRole('button', { name: 'Doğrula' }).click();
  await p.waitForFunction(() => /Aydınlatma|Hoş Geldiniz/.test(document.body.innerText));
  if (await p.getByRole('heading', { name: 'Aydınlatma' }).isVisible()) {
    await p.getByRole('button', { name: 'Bilgilendim' }).click();
    await p.getByRole('heading', { name: 'İsteğe Bağlı İzinler' }).waitFor();
    await p.getByRole('button', { name: 'Devam' }).click();
    await p.getByRole('button', { name: 'Ana Ekrana Geç' }).click();
  }
  await p.getByRole('heading', { name: /Hoş Geldiniz/ }).waitFor();
  await p.waitForTimeout(500);
  await p.screenshot({ path: webCikti, fullPage: true });
  await p.setViewportSize({ width: 390, height: 844 });
  await p.waitForTimeout(300);
  await p.screenshot({ path: telCikti, fullPage: true });
  console.log('kartlar:', await p.locator('.bolum').allTextContents(), 'onay', await p.getByRole('button', { name: 'Onayla' }).count());
  await p.getByRole('button', { name: 'Çıkış' }).click();
} finally {
  await t.close();
  await sup.query(`UPDATE kullanici_hesabi SET totp_gizli_sifreli = $2, totp_son_adim = $3, izin_adimi_zamani = $4 WHERE kimlik = $1`, [once.kimlik, once.totp_gizli_sifreli, once.totp_son_adim, once.izin_adimi_zamani]);
  if (ayd === 0) await sup.query(`DELETE FROM aydinlatma_kaydi WHERE ilgili_kisi_ref = $1`, [once.kimlik]);
  await sup.end();
}
