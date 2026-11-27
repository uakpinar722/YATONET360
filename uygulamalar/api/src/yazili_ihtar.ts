import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { izYaz } from './denetim.js';
import { tamOturumGerekli, type Baglam } from './kimlik.js';
import { gunAy, tutar, type Dil } from './metin.js';
import { pdfUret, type BelgeTanim } from './pdf.js';
import { UUID } from './yat.js';

const KOK = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
let metin: Record<Dil, Record<string, string>> | undefined;
const TID = 'Ticari İşler Direktörü';
const eur = (x: number) => `${tutar(x, 'tr')} EUR`;

/**
 * YG-546, YG-911, V-1127: alacak takibinin 15. gün basamağında Ticari İşler Direktörünün yazılı ihtarı (TR/EN, CEO onaylı metin 27.11.2026).
 * Yalnız vadesi geçmiş ve ödenmemiş faturada üretilir; sigorta şirketine (D-040) ve vefat işaretli dosyada (YG-1521) üretilmez. Son ödeme tarihini Direktör girer.
 * KEP gönderimi KEP kararı (dondu) nedeniyle yoktur; ihtar PDF olarak üretilir, gönderim kanalı ve tarihi kayda geçer.
 */
export function yaziliIhtarYollari(s: FastifyInstance, b: Baglam) {
  const oturumlu = { preHandler: tamOturumGerekli(b) };
  const yok = (y: FastifyReply) => y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' });
  const tid = async (k: string) => Boolean((await b.db.query(`SELECT 1 FROM rol_atamasi a JOIN rol x ON x.kimlik = a.rol_ref WHERE a.kullanici_ref = $1 AND a.atama_durumu = 'Aktif' AND x.rol_adi = $2`, [k, TID])).rowCount);

  s.post('/fatura/:id/yazili-ihtar', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { son?: string; dil?: string; kanal?: string };
    if (!UUID.test(id) || !(await tid(o.kullanici))) return yok(y);
    const f = (await b.db.query(`SELECT f.kimlik, f.fatura_no, f.fatura_tarihi, f.vade, f.toplam_eur, f.tahsil_edilen_eur, f.muhatap, d.kimlik dosya, d.dosya_no, d.musteri_turu, d.vefat_isareti FROM musteri_faturasi f JOIN dosya d ON d.kimlik = f.dosya_ref WHERE f.kimlik = $1`, [id])).rows[0];
    if (!f) return yok(y);
    if (f.musteri_turu === 'Sigorta Şirketi' || f.muhatap === 'Sigorta Şirketi') return y.code(409).send({ hata: 'Sigorta şirketine yazılı ihtar gönderilmez; muhatabı arayınız.' });
    if (f.vefat_isareti) return y.code(409).send({ hata: 'Vefat işaretli dosyada ihtar üretilmez; alacak Hukuk ve Uyum yönetimindedir.' });
    const kalan = Math.round((Number(f.toplam_eur) - Number(f.tahsil_edilen_eur ?? 0)) * 100) / 100;
    if (!f.fatura_no || !f.vade || new Date(f.vade) >= new Date(new Date().toISOString().slice(0, 10)) || kalan <= 0) return y.code(409).send({ hata: 'Yazılı ihtar yalnız vadesi geçmiş ve ödenmemiş faturada üretilir.' });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(g.son ?? '') || g.son! <= new Date().toISOString().slice(0, 10)) return y.code(400).send({ hata: 'İleri bir son ödeme tarihi giriniz.' });
    if (!['PDF (elden)', 'E-posta', 'Posta', 'Noter'].includes(g.kanal ?? '')) return y.code(400).send({ hata: 'Gönderim kanalını seçiniz.' });
    const dil: Dil = g.dil === 'en' ? 'en' : 'tr';
    metin ??= JSON.parse(readFileSync(join(KOK, 'veri', 'sablon', 'yazili_ihtar.json'), 'utf8'));
    const M = metin![dil]!;
    const muhatap = (await b.db.query(`SELECT kisi_adi_soyadi FROM dosya_tarafi WHERE dosya_ref = $1 AND taraf_rolu = 'Yat Sahibi' AND aktif LIMIT 1`, [f.dosya])).rows[0]?.kisi_adi_soyadi as string | undefined;
    const t: BelgeTanim = {
      ad: M.ad!, kod: 'FR-TIC-IHT', no: f.fatura_no, tarih: gunAy(new Date()), surum: 'Rev.1', dil,
      bolumler: [
        { baslik: M.muhatap!, tur: 'alanlar', numarasiz: true, alanlar: [{ et: M.kime!, deger: muhatap ?? null, genis: true }, { et: M.konu!, deger: M.konuD!, genis: true }] },
        { baslik: M.b1!, tur: 'alanlar', alanlar: [{ et: M.faturaNo!, deger: f.fatura_no }, { et: M.faturaTarihi!, deger: f.fatura_tarihi ? gunAy(f.fatura_tarihi) : null }, { et: M.vade!, deger: gunAy(f.vade) }, { et: M.dosyaNo!, deger: f.dosya_no },
          { et: M.toplam!, deger: eur(Number(f.toplam_eur)) }, { et: M.odenen!, deger: eur(Number(f.tahsil_edilen_eur ?? 0)) }, { et: M.kalan!, deger: eur(kalan) }] },
        { baslik: M.b2!, tur: 'metin', metin: M.govde!.replace('{vade}', gunAy(f.vade)).replace('{kalan}', eur(kalan)).replace('{son}', gunAy(g.son!)) },
        { baslik: M.b3!, tur: 'metin', metin: M.odemeD! },
        { baslik: M.b4!, tur: 'alanlar', alanlar: [{ et: M.b4!, deger: M.gonderen!, genis: true }, { et: M.imzalayan!, deger: M.saygi! }] },
      ],
    };
    await b.db.query(`INSERT INTO yazili_ihtar (fatura_ref, dil, son_odeme_tarihi, kanal, kalan_eur, ureten_ref) VALUES ($1,$2,$3,$4,$5,$6)`, [id, dil, g.son, g.kanal, kalan, o.kullanici]);
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Yazılı İhtar Üretildi', nesneTuru: 'Fatura', nesneKimligi: id, yeni: { son: g.son, kanal: g.kanal, kalan }, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return y.type('application/pdf').header('Content-Disposition', `inline; filename="${encodeURIComponent(`${f.fatura_no}-IHTAR-${dil.toUpperCase()}.pdf`)}"`).send(await pdfUret(t));
  });

  s.get('/fatura/:id/yazili-ihtarlar', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string };
    if (!UUID.test(id) || !(await tid(o.kullanici))) return yok(y);
    return (await b.db.query(`SELECT dil, son_odeme_tarihi::text son, kanal, kalan_eur, zaman FROM yazili_ihtar WHERE fatura_ref = $1 ORDER BY zaman DESC`, [id])).rows;
  });
}
