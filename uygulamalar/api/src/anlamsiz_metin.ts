import type { FastifyInstance } from 'fastify';

/** YG-1375: geçici veya anlamsız metin: yalnız noktalama/simge, aynı karakterin en az üç kez tekrarı, bilinen yer tutucular. */
const YER_TUTUCU = /^(test|deneme|asd|asdf|qwe|qwerty|xyz|lorem ipsum.*|tbd|todo)$/i;
export function anlamsizMetin(s: string): boolean {
  const t = s.trim();
  if (!t) return false; // boşluk denetimi alanın zorunluluk kuralına aittir
  return !/[\p{L}\p{N}]/u.test(t) || /^(.)\1{2,}$/u.test(t.replace(/\s+/g, '')) || YER_TUTUCU.test(t);
}
const ALANLAR = ['gerekce', 'aciklama'];

export function anlamsizMetinKancasi(s: FastifyInstance) {
  s.addHook('preValidation', async (i, y) => {
    if (!['POST', 'PUT', 'PATCH'].includes(i.method) || !i.body || typeof i.body !== 'object') return;
    for (const a of ALANLAR) {
      const v = (i.body as Record<string, unknown>)[a];
      if (typeof v === 'string' && anlamsizMetin(v)) return y.code(400).send({ hata: 'Açıklamayı anlamlı bir metinle yazmanızı rica ederiz.' });
    }
  });
}
