import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/** YG-1559: cümle olmayan düğme, başlık, bölüm ve etiketlerde her kelimenin baş harfi büyüktür ("ve", "veya", "ile" gibi bağlaçlar küçük); parantez içi açıklama ve birim kurala girmez. */
const KUCUK = new Set(['ve', 'veya', 'ile', 'ya', 'da', 'de', 'ki', 'mi', 'için', 'or', 'and', 'of', 'the', 'to', 'in', 'a', 'on', 'for', 'by']);
const RX = [/<button[^>]*>([^<{]{2,60})<\/button>/g, /className="bolum[^"]*">([^<{]{2,60})</g, /baslik="([^"{]{2,60})"/g, /<summary>([^<{]{2,60})<\/summary>/g, /<label[^>]*>([^<{]{2,60})<\/label>/g];
const kural = (ham: string) => {
  const s = ham.split('>').pop()!.replace(/\([^)]*\)/g, '').trim();
  if (!s || s.length > 60 || s.endsWith('.') || s.includes('?') || s.includes(':')) return true;
  return s.split(/[ /(),·]+/).every((w) => !w || !/^\p{L}/u.test(w) || KUCUK.has(w.toLocaleLowerCase('tr')) || w[0] === w[0]!.toLocaleUpperCase('tr'));
};

describe('ekran yazım kuralı (YG-1559)', () => {
  it('düğme, başlık ve etiketlerde kelime başları büyük harftir', () => {
    const k = join(import.meta.dirname, '..', '..', 'web', 'src');
    const ihlal: string[] = [];
    for (const f of readdirSync(k).filter((x) => x.endsWith('.tsx'))) {
      const t = readFileSync(join(k, f), 'utf8');
      for (const rx of RX) for (const m of t.matchAll(rx)) if (!kural(m[1]!)) ihlal.push(`${f}: ${m[1]!.split('>').pop()!.trim()}`);
    }
    expect(ihlal).toEqual([]);
  });
});
