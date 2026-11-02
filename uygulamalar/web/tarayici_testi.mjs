// Gerçek tarayıcıda (Edge) G-1 akışı: hatalı parola, ilk kurulum, kod, panel, yetkili sayfa, çıkış. Sentetik hesapla çalışır ve hesabın kurulumunu geri alır.
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';
import { chromium } from 'playwright-core';

const CIKTI = process.argv[2] ?? '.';
const env = Object.fromEntries(readFileSync('C:/YATONET360/.env.local', 'utf8').split(/\r?\n/).filter(Boolean).map((s) => s.split(/=(.*)/s).slice(0, 2)));
const [, ep, parola] = readFileSync('C:/YATONET360/.araclar/deneme_hesaplari.txt', 'utf8').split('\n').map((l) => l.split('\t')).find((s) => s[0] === 'İç Denetçi');
const B = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function totp(g) {
  let bit = 0, d = 0; const c = [];
  for (const h of g) { d = (d << 5) | B.indexOf(h); bit += 5; if (bit >= 8) { c.push((d >>> (bit - 8)) & 255); bit -= 8; } }
  const s = Buffer.alloc(8); s.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const m = createHmac('sha1', Buffer.from(c)).update(s).digest(); const o = m[m.length - 1] & 15;
  return String((m.readUInt32BE(o) & 0x7fffffff) % 1e6).padStart(6, '0');
}
const tarayici = await chromium.launch({ channel: 'msedge', headless: true });
const sonuc = [];
const kontrol = (ad, kosul) => { sonuc.push(`${kosul ? 'GEÇTİ' : 'KALDI'}  ${ad}`); };
try {
  const p = await (await tarayici.newContext({ viewport: { width: 390, height: 844 }, locale: 'tr-TR' })).newPage();
  const hatalar = []; p.on('pageerror', (e) => hatalar.push(e.message));
  await p.goto('http://127.0.0.1:5173/');
  await p.screenshot({ path: join(CIKTI, 't1_giris_tel.png') });
  kontrol('telefonda yatay taşma yok', await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  await p.getByRole('button', { name: 'Giriş' }).click();
  kontrol('boş alan uyarısı', await p.getByRole('alert').textContent() === 'Lütfen iki alanı da doldurunuz.');
  await p.getByLabel('E-Posta veya Cep Telefonu').fill(ep);
  await p.getByLabel('Parola').fill('yanlis-parola-12345');
  await p.getByRole('button', { name: 'Giriş' }).click();
  await p.getByText('5 hatalı denemede').waitFor();
  kontrol('hatalı parola uyarısı', true);
  await p.getByRole('button', { name: 'EN', exact: true }).click();
  kontrol('İngilizce metin', await p.getByRole('button', { name: 'Sign In' }).isVisible());
  await p.getByRole('button', { name: 'TR', exact: true }).click();
  await p.getByRole('button', { name: 'Hesap Oluştur' }).click();
  kontrol('Hesap Oluştur beş seçenek', await p.locator('.secenek').count() === 5);
  await p.getByRole('button', { name: '← Geri' }).click();
  await p.getByLabel('Parola').fill(parola);
  await p.getByRole('button', { name: 'Giriş' }).click();
  await p.locator('.kurulum code').waitFor();
  kontrol('ilk girişte kurulum kare kodu', await p.locator('.kurulum img').isVisible());
  kontrol('LGM personelinde SMS düğmesi yok', !(await p.getByRole('button', { name: 'Kodu SMS ile Gönder' }).isVisible()));
  kontrol('kod tamamlanmadan düğme kapalı', await p.getByRole('button', { name: 'Doğrula' }).isDisabled());
  await p.screenshot({ path: join(CIKTI, 't2_kurulum_tel.png'), fullPage: true });
  const gizli = await p.locator('.kurulum code').textContent();
  await p.locator('.kod input').first().focus();
  await p.keyboard.type(totp(gizli), { delay: 20 });
  await p.getByRole('button', { name: 'Doğrula' }).click();
  await p.getByRole('heading', { name: /Hoş Geldiniz/ }).waitFor();
  kontrol('giriş sonrası rol görünür', await p.getByText('İç Denetçi', { exact: true }).isVisible());
  kontrol('yetkisi olmayan menü gizli', !(await p.getByRole('button', { name: 'Rol Kataloğu' }).isVisible()));
  await p.screenshot({ path: join(CIKTI, 't3_panel_tel.png') });
  await p.setViewportSize({ width: 1280, height: 800 });
  await p.getByRole('button', { name: 'İşlem İzi' }).click();
  await p.locator('table').waitFor();
  kontrol('işlem izi tablosu', await p.locator('tbody tr').count() > 0);
  await p.screenshot({ path: join(CIKTI, 't4_iz_web.png') });
  await p.reload();
  kontrol('yenilemede oturum sürer', await p.getByRole('heading', { name: /Hoş Geldiniz/ }).isVisible().catch(() => false) || await p.getByRole('heading', { name: /Hoş Geldiniz/ }).waitFor({ timeout: 4000 }).then(() => true));
  await p.getByRole('button', { name: 'Çıkış' }).click();
  await p.getByLabel('Parola').waitFor();
  kontrol('çıkış giriş ekranına döner', true);
  kontrol('sayfa hatası yok', hatalar.length === 0);
} catch (e) {
  sonuc.push('KALDI  beklenmeyen: ' + e.message.split('\n')[0]);
} finally {
  await tarayici.close();
  const c = new pg.Client({ host: 'localhost', user: 'postgres', password: env.POSTGRES_SUPER_PAROLA, database: 'yatonet360' });
  await c.connect();
  await c.query(`UPDATE kullanici_hesabi SET totp_gizli_sifreli = NULL, totp_son_adim = 0, basarisiz_giris_sayisi = 0, kilit_bitis_zamani = NULL WHERE e_posta = $1`, [ep]);
  await c.end();
}
console.log(sonuc.join('\n'));
if (sonuc.some((s) => s.startsWith('KALDI'))) process.exit(1);

