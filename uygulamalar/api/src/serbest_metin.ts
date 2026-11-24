import type { FastifyInstance } from 'fastify';

/** YG-1179: serbest metin alanlarında gereksiz kişisel veri birikmez; geçerli TC kimlik numarası, IBAN veya ödeme kartı numarası serbest metne yazılmaz, kendi alanında tutulur. */
const SERBEST = ['gerekce', 'aciklama', 'not', 'ozet', 'metin', 'sonuc', 'tutanak', 'tedbir', 'firmaOzeti', 'konu', 'gundem', 'yorum', 'neden', 'notMetni'];
const tcknGecerli = (s: string) => {
  const d = [...s].map(Number); if (d[0] === 0) return false;
  const tek = d[0]! + d[2]! + d[4]! + d[6]! + d[8]!; const cift = d[1]! + d[3]! + d[5]! + d[7]!;
  return (((tek * 7 - cift) % 10) + 10) % 10 === d[9] && d.slice(0, 10).reduce((a, b) => a + b, 0) % 10 === d[10];
};
const luhn = (s: string) => { let t = 0; [...s].reverse().forEach((c, n) => { let x = Number(c); if (n % 2) { x *= 2; if (x > 9) x -= 9; } t += x; }); return t % 10 === 0; };

/** Serbest metinde bulunan kişisel veri türü; yoksa null. */
export function kisiselVeriTuru(metin: string): string | null {
  if ((metin.match(/(?<!\d)\d{11}(?!\d)/g) ?? []).some(tcknGecerli)) return 'TC kimlik numarası';
  if (/\bTR\s?\d{2}(?:\s?\d{4}){5}\s?\d{2}\b/i.test(metin)) return 'IBAN';
  if ((metin.match(/(?<![\d-])[3-6]\d{3}(?:[ -]?\d{4}){3}(?![\d-])/g) ?? []).map((x) => x.replace(/\D/g, '')).some((x) => x.length === 16 && luhn(x))) return 'kart numarası';
  return null;
}

export function serbestMetinKancasi(s: FastifyInstance) {
  s.addHook('preValidation', async (i, y) => {
    if (!['POST', 'PUT', 'PATCH'].includes(i.method) || !i.body || typeof i.body !== 'object' || Buffer.isBuffer(i.body)) return;
    for (const a of SERBEST) {
      const v = (i.body as Record<string, unknown>)[a];
      const tur = typeof v === 'string' ? kisiselVeriTuru(v) : null;
      if (tur) return y.code(400).send({ hata: `Serbest metne ${tur} yazılmaz; bu bilgi kendi alanında tutulur.` });
    }
  });
}
