import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const ozet = (s: string) => createHash('sha256').update(s).digest('hex');
export const rastgeleBelirtec = () => randomBytes(32).toString('base64url');

/** YG-1196: gizli değerler anahtarı veriden ayrı tutularak saklanır. */
export function sifrele(acik: string, anahtarHex: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', Buffer.from(anahtarHex, 'hex'), iv);
  const v = Buffer.concat([c.update(acik, 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), v].map((b) => b.toString('base64url')).join('.');
}
export function coz(paket: string, anahtarHex: string): string {
  const [iv, etiket, v] = paket.split('.').map((p) => Buffer.from(p, 'base64url'));
  const d = createDecipheriv('aes-256-gcm', Buffer.from(anahtarHex, 'hex'), iv!);
  d.setAuthTag(etiket!);
  return Buffer.concat([d.update(v!), d.final()]).toString('utf8');
}

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function base32(b: Buffer): string {
  let bit = 0, deger = 0, s = '';
  for (const x of b) {
    deger = (deger << 8) | x; bit += 8;
    while (bit >= 5) { s += B32[(deger >>> (bit - 5)) & 31]; bit -= 5; }
  }
  if (bit > 0) s += B32[(deger << (5 - bit)) & 31];
  return s;
}
function base32Coz(s: string): Buffer {
  let bit = 0, deger = 0; const c: number[] = [];
  for (const h of s) {
    deger = (deger << 5) | B32.indexOf(h); bit += 5;
    if (bit >= 8) { c.push((deger >>> (bit - 8)) & 255); bit -= 8; }
  }
  return Buffer.from(c);
}
export const totpGizliUret = () => base32(randomBytes(20));

/** RFC 6238: 30 saniyelik adım, 6 hane. */
export function totpKodu(gizli: string, adim: number): string {
  const sayac = Buffer.alloc(8); sayac.writeBigUInt64BE(BigInt(adim));
  const h = createHmac('sha1', base32Coz(gizli)).update(sayac).digest();
  const o = h[h.length - 1]! & 15;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}
export const suankiAdim = (ms = Date.now()) => Math.floor(ms / 30_000);

/** Geçerliyse eşleşen adımı döndürür. ±1 adım saat farkını karşılar; son kullanılan adım tekrar kabul edilmez. */
export function totpDogrula(gizli: string, kod: string, sonAdim: number, ms = Date.now()): number | null {
  const a = suankiAdim(ms);
  for (const adim of [a - 1, a, a + 1]) {
    if (adim <= sonAdim) continue;
    const beklenen = Buffer.from(totpKodu(gizli, adim));
    const gelen = Buffer.from(kod);
    if (gelen.length === beklenen.length && timingSafeEqual(gelen, beklenen)) return adim;
  }
  return null;
}
