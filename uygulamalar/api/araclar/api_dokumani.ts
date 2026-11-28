// YG-628: API dokümanı kaynak koddan üretilir; her uç nokta için yöntem, yol, erişim türü ve kod içi açıklama.
// Kullanım: npm run api-dokumani → API_DOKUMANI.md (her sürümde yeniden üretilir; elle düzeltilmez).
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const KOK = join(import.meta.dirname, '..');
const KAYNAK = join(KOK, 'src');
type Uc = { yontem: string; yol: string; erisim: string; aciklama: string; satir: number };

/** Uç noktanın erişim türü: ön işleyiciden çıkarılır. */
function erisim(satir: string): string {
  const izin = satir.match(/izinGerekli\(b,\s*'([^']+)'/);
  if (izin) return `Oturum + izin: ${izin[1]}`;
  if (/serbest|tamOturumGerekli\(b,\s*true\)/.test(satir)) return 'Oturum (ilk giriş adımlarında da)';
  if (/oturumlu|tamOturumGerekli|ihbarci|preHandler/.test(satir)) return 'Oturum';
  return 'Oturumsuz';
}

/** Uç noktadan hemen önceki yorum satırları (// veya /** *\/) açıklama olarak alınır. */
function aciklama(satirlar: string[], i: number): string {
  const l: string[] = [];
  for (let k = i - 1; k >= 0 && k >= i - 6; k--) {
    const s = satirlar[k]!.trim();
    if (s.startsWith('//')) l.unshift(s.replace(/^\/\/\s?/, ''));
    else if (s.startsWith('*') || s.startsWith('/**')) l.unshift(s.replace(/^\/\*\*\s?|^\*\/?\s?|\*\/$/g, '').trim());
    else break;
  }
  const ic = satirlar[i]!.match(/\/\/\s*(.+)$/)?.[1];
  return [...l, ic].filter(Boolean).join(' ').replace(/\s+/g, ' ').replace(/\|/g, '/').trim();
}

const moduller: [string, Uc[]][] = [];
for (const d of readdirSync(KAYNAK).filter((x) => x.endsWith('.ts')).sort()) {
  const satirlar = readFileSync(join(KAYNAK, d), 'utf8').split(/\r?\n/);
  const uclar: Uc[] = [];
  satirlar.forEach((s, i) => {
    const m = s.match(/\bs\.(get|post|put|patch|delete)\(\s*'([^']+)'/);
    if (m) uclar.push({ yontem: m[1]!.toUpperCase(), yol: `/api${m[2]}`, erisim: erisim(s), aciklama: aciklama(satirlar, i), satir: i + 1 });
  });
  if (uclar.length) moduller.push([d, uclar]);
}

const toplam = moduller.reduce((a, [, u]) => a + u.length, 0);
const md = [
  '# YATONET 360 API Dokümanı',
  '',
  `Kaynak koddan üretilmiştir (\`npm run api-dokumani\`); ${moduller.length} modül, ${toplam} uç nokta. Elle düzeltilmez; kod değişince yeniden üretilir.`,
  '',
  '## Genel Kurallar',
  '',
  '- Tüm uç noktalar `/api` önekiyle sunulur; istek ve yanıt gövdesi JSON\'dur (belge yükleme `application/octet-stream`).',
  '- Oturum çerezle taşınır; durum değiştiren isteklerde `X-Yatonet: 1` üst bilgisi zorunludur.',
  '- Hata yanıtı `{ "hata": "<tek cümle açıklama>" }` biçimindedir; takılan adımda `islem` (düğme adı) ve `hedef` (ekran alanı) eklenebilir.',
  '- Durum kodları: 400 eksik veya geçersiz bilgi, 401 oturum yok, 403 yetki yok, 404 kayıt yok veya erişim yok, 409 iş kuralı engeli, 428 ilk giriş adımları eksik.',
  '- Erişim sütunu: "Oturum" tam oturum ister; "Oturum + izin" ayrıca belirtilen izni ister; rol ve dosya erişimi uç nokta içinde ayrıca denetlenir.',
  '',
  '## Modüller',
  '',
  ...moduller.flatMap(([d, u]) => [`### ${d.replace(/\.ts$/, '')}`, '', '| Yöntem | Yol | Erişim | Açıklama |', '|---|---|---|---|', ...u.map((x) => `| ${x.yontem} | \`${x.yol}\` | ${x.erisim} | ${x.aciklama || '—'} |`), '']),
].join('\n');
writeFileSync(join(KOK, 'API_DOKUMANI.md'), md, 'utf8');
console.log(`API_DOKUMANI.md: ${moduller.length} modül, ${toplam} uç nokta`);
