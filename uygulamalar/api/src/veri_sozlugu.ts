import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { izYaz } from './denetim.js';
import { tamOturumGerekli, type Baglam } from './kimlik.js';

const KOK = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const HUKUK = ['Hukuk ve Uyum Direktörü', 'Hukuk ve Uyum Uzmanı'];
type Alan = { modul: string; varlik: string; alan: string; teknik: string; aciklama: string; tip: string; bicim: string; zorunlu: string; liste: string; dogrulama: string; kaynak: string; sahip: string; sinif: string; kisisel: string; saklama: string; grup: string; ekran: string };
let onbellek: Alan[] | null = null;
const alanlar = () => (onbellek ??= JSON.parse(readFileSync(join(KOK, 'veri/sablon/alan_sozlugu.json'), 'utf-8')) as Alan[]);
const kucuk = (s: string) => s.toLocaleLowerCase('tr-TR');

/** YG-1243: ortak veri sözlüğü LGM-2026-014'ten okunur. YG-1179: kişisel veri envanteri varlık bazında; amaç ve hukuki sebep Hukuk tarafından girilir. */
export function veriSozluguYollari(s: FastifyInstance, b: Baglam) {
  const oturumlu = { preHandler: tamOturumGerekli(b) };
  const yok = (y: FastifyReply) => y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' });
  const hukuk = async (k: string) => Boolean((await b.db.query(`SELECT 1 FROM rol_atamasi a JOIN rol x ON x.kimlik = a.rol_ref WHERE a.kullanici_ref = $1 AND a.atama_durumu = 'Aktif' AND x.rol_adi = ANY($2::text[]) LIMIT 1`, [k, HUKUK])).rowCount);

  s.get('/veri-sozlugu', oturumlu, async (i, y) => {
    if (i.oturum!.grup !== 'LGM İç Rolü') return yok(y);
    const q = kucuk(String((i.query as { q?: string }).q ?? '').trim());
    if (q.length < 2) return y.code(400).send({ hata: 'En az iki harf yazınız.' });
    const l = alanlar().filter((a) => kucuk(`${a.alan} ${a.teknik} ${a.varlik}`).includes(q));
    return { toplam: l.length, satirlar: l.slice(0, 100) };
  });

  s.get('/veri-envanteri', oturumlu, async (i, y) => {
    if (!(await hukuk(i.oturum!.kullanici))) return yok(y);
    const grup = new Map<string, { varlik: string; alanlar: string[]; ozel: number; saklama: Set<string> }>();
    for (const a of alanlar()) {
      if (a.kisisel !== 'Evet' && a.kisisel !== 'Özel nitelikli') continue;
      const g = grup.get(a.varlik) ?? { varlik: a.varlik, alanlar: [], ozel: 0, saklama: new Set<string>() };
      g.alanlar.push(a.alan); if (a.kisisel === 'Özel nitelikli') g.ozel++; if (a.saklama) g.saklama.add(a.saklama); grup.set(a.varlik, g);
    }
    const kayit = new Map((await b.db.query(`SELECT * FROM kisisel_veri_envanteri`)).rows.map((r) => [r.varlik as string, r]));
    return [...grup.values()].sort((x, z) => x.varlik.localeCompare(z.varlik, 'tr')).map((g) => { const k = kayit.get(g.varlik); return { varlik: g.varlik, alanSayisi: g.alanlar.length, ozelNitelikli: g.ozel, saklama: [...g.saklama], ilgiliKisi: k?.ilgili_kisi_grubu ?? null, kategori: k?.veri_kategorisi ?? null, amac: k?.isleme_amaci ?? null, hukuki: k?.hukuki_sebep ?? null, alici: k?.alici ?? null, tedbir: k?.guvenlik_tedbiri ?? null, tamam: Boolean(k) }; });
  });

  s.post('/veri-envanteri', oturumlu, async (i, y) => {
    const o = i.oturum!; const g = (i.body ?? {}) as { varlik?: string; ilgiliKisi?: string; kategori?: string; amac?: string; hukuki?: string; alici?: string; tedbir?: string };
    if (!(await hukuk(o.kullanici))) return yok(y);
    if (!g.varlik || !alanlar().some((a) => a.varlik === g.varlik && a.kisisel !== 'Hayır')) return y.code(400).send({ hata: 'Kişisel veri içeren bir varlık seçiniz.' });
    const D = [g.ilgiliKisi, g.kategori, g.amac, g.hukuki, g.alici, g.tedbir].map((x) => x?.trim());
    if (D.some((x) => !x)) return y.code(400).send({ hata: 'İlgili kişi grubu, kategori, amaç, hukuki sebep, alıcı ve güvenlik tedbiri zorunludur.' });
    await b.db.query(`INSERT INTO kisisel_veri_envanteri (varlik, ilgili_kisi_grubu, veri_kategorisi, isleme_amaci, hukuki_sebep, alici, guvenlik_tedbiri, guncelleyen_ref) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (varlik) DO UPDATE SET ilgili_kisi_grubu = $2, veri_kategorisi = $3, isleme_amaci = $4, hukuki_sebep = $5, alici = $6, guvenlik_tedbiri = $7, guncelleyen_ref = $8, zaman = now()`, [g.varlik, ...D, o.kullanici]);
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Kişisel Veri Envanteri', nesneTuru: 'Varlık', nesneKimligi: g.varlik, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { tamam: true };
  });
}
