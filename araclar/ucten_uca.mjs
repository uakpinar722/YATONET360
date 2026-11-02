// Çalışan sisteme web adresi üzerinden yat sahibi girişi: parola, SMS kutusundan kod, panel bilgisi, çıkış.
import { readFileSync } from 'node:fs';
const A = 'http://127.0.0.1:5173/api';
const sat = readFileSync('C:/YATONET360/.araclar/deneme_hesaplari.txt', 'utf8').split('\n').filter(Boolean).map((l) => l.split('\t'));
const [, ep, parola] = sat.find((s) => s[0] === 'Müşteri Portal Kullanıcısı');
let cerez = '';
async function ist(y, g) {
  const r = await fetch(A + y, { method: g ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', 'X-Yatonet': '1', Cookie: cerez }, body: g ? JSON.stringify(g) : undefined });
  const c = r.headers.get('set-cookie'); if (c) cerez = c.split(';')[0];
  return { kod: r.status, json: await r.json() };
}
console.log('oturumsuz /ben', (await ist('/ben')).kod);
console.log('yanlış parola', (await ist('/kimlik/giris', { kimlik: ep, parola: 'yanlis-parola-123' })).kod);
console.log('giriş', JSON.stringify((await ist('/kimlik/giris', { kimlik: ep, parola })).json));
console.log('sms', (await ist('/kimlik/sms', {})).kod);
const kod = readFileSync('C:/YATONET360/.araclar/sms_kutusu.txt', 'utf8').trim().split('\n').at(-1).match(/kodunuz: (\d{6})/)[1];
console.log('doğrula', (await ist('/kimlik/dogrula', { kod })).json);
const b = await ist('/ben');
console.log('ben', b.kod, b.json.adSoyad, b.json.roller.map((r) => r.rol_adi), 'izin', b.json.izinler);
console.log('izinsiz rol kataloğu', (await ist('/yetki/roller')).kod);
console.log('çıkış', (await ist('/kimlik/cikis', {})).kod, '| sonra /ben', (await ist('/ben')).kod);
