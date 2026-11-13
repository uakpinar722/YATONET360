import type { FastifyInstance, FastifyReply } from 'fastify';
import { dosyaErisimi } from './dosya.js';
import { tamOturumGerekli, type Baglam } from './kimlik.js';
import { gunAy } from './metin.js';
import { pdfUret, type Bolum, type Hucre } from './pdf.js';
import { UUID } from './yat.js';

/** YG-685: kontrol listesi yanıtları Evet / Hayır / Uygulanmaz; eski adlar aynı anlama eşlenir. */
export const KL_SONUC = ['Evet', 'Hayır', 'Uygulanmaz'] as const;
export const klSonuc = (x?: string) => ({ Uygun: 'Evet', 'Uygun Değil': 'Hayır', 'Geçerli Değil': 'Uygulanmaz' } as Record<string, string>)[x ?? ''] ?? x;
const renkli = (s: string | null): Hucre => (s === 'Evet' ? { m: s, renk: 'yesil' } : s === 'Hayır' ? { m: s, renk: 'kirmizi' } : s);

export function kontrolListesiYollari(s: FastifyInstance, b: Baglam) {
  const oturumlu = { preHandler: tamOturumGerekli(b) };
  const yok = (y: FastifyReply) => y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' });
  const kayit = async (id: string, k: string) => {
    if (!UUID.test(id)) return null;
    const r = (await b.db.query(`SELECT k.*, d.dosya_no, f.ad, h.ad_soyad hazirlayan, (SELECT r.rol_adi FROM rol_atamasi a JOIN rol r ON r.kimlik = a.rol_ref WHERE a.kullanici_ref = k.onaylayan_ref AND a.atama_durumu = 'Aktif' LIMIT 1) onaylayan_rol
      FROM kontrol_listesi_kaydi k JOIN dosya d ON d.kimlik = k.dosya_ref LEFT JOIN form_katalogu f ON f.kod = k.kontrol_listesi LEFT JOIN kullanici_hesabi h ON h.kimlik = k.hazirlayan_ref WHERE k.kimlik = $1`, [id])).rows[0];
    return r && (await dosyaErisimi(b.db, k, r.dosya_ref)) ? r : null;
  };
  const maddeler = async (id: string) => (await b.db.query(`SELECT madde, kritik, sonuc, aciklama, kanit_tanimi, kanit_belge_ref FROM kontrol_listesi_maddesi WHERE kayit_ref = $1 ORDER BY madde`, [id])).rows;

  s.get('/kontrol-listesi-kodlari', oturumlu, async (i, y) => {
    if (i.oturum!.grup !== 'LGM İç Rolü') return yok(y);
    return (await b.db.query(`SELECT DISTINCT split_part(l.deger, ' / ', 1) kod, f.ad FROM deger_listesi l LEFT JOIN form_katalogu f ON f.kod = split_part(l.deger, ' / ', 1) WHERE l.liste_kodu = 'LST_KONTROL_LISTESI_MADDESI' ORDER BY 1`)).rows;
  });
  s.get('/kontrol-listesi/:id', oturumlu, async (i, y) => {
    const o = i.oturum!; const k = await kayit((i.params as { id: string }).id, o.kullanici); if (!k) return yok(y);
    return { kimlik: k.kimlik, kayitNo: k.kayit_no, kod: k.kontrol_listesi, ad: k.ad, statu: k.statu, eksikler: k.eksikler, hazirlayanBenim: k.hazirlayan_ref === o.kullanici, maddeler: await maddeler(k.kimlik) };
  });
  // Durum tablosu: Evet yeşil, Hayır kırmızı, Uygulanmaz renksiz; iç kayıttır.
  s.get('/kontrol-listesi/:id/pdf', oturumlu, async (i, y) => {
    const o = i.oturum!; const k = await kayit((i.params as { id: string }).id, o.kullanici); if (!k) return yok(y);
    const m = await maddeler(k.kimlik);
    const say = (s: string) => m.filter((x) => x.sonuc === s).length;
    const bolumler: Bolum[] = [
      { baslik: 'Durum Özeti', tur: 'tablo', sutunlar: [{ ad: 'Evet', hiza: 'ort' }, { ad: 'Hayır', hiza: 'ort' }, { ad: 'Uygulanmaz', hiza: 'ort' }, { ad: 'Yanıtsız', hiza: 'ort' }], satirlar: [[say('Evet'), say('Hayır') ? { m: String(say('Hayır')), renk: 'kirmizi' } : 0, say('Uygulanmaz'), m.filter((x) => !x.sonuc).length]] },
      { baslik: 'Maddeler', tur: 'tablo', sutunlar: [{ ad: 'Sıra', hiza: 'ort' }, { ad: 'Madde' }, { ad: 'Sonuç', hiza: 'ort' }, { ad: 'Açıklama' }, { ad: 'Kanıt', hiza: 'ort' }],
        satirlar: m.map((x, n) => [n + 1, `${String(x.madde).replace(/^[A-Z]{2}-[A-Z]{3}-\d{3} \/ /, '')}${x.kritik ? ' (kritik)' : ''}`, renkli(x.sonuc), x.aciklama, x.kanit_tanimi ? (x.kanit_belge_ref ? 'Var' : { m: 'Yok', renk: 'sari' }) : null]) },
      { baslik: 'Sonuç', tur: 'alanlar', alanlar: [{ et: 'Durum', deger: k.statu }, { et: 'Eksikler', deger: k.eksikler, genis: true }, { et: 'Onay', deger: k.onay_zamani ? `${k.onaylayan_rol ?? '---'} · ${gunAy(k.onay_zamani)} · YATONET 360` : null, genis: true }] },
    ];
    const pdf = await pdfUret({ ad: k.ad ?? 'Kontrol Listesi', kod: k.kontrol_listesi, no: k.kayit_no, dosyaNo: k.dosya_no, tarih: gunAy(k.onay_zamani ?? k.olusturma_zamani), surum: 'Rev.1', dil: 'tr', icKayit: true, bolumler });
    return y.type('application/pdf').header('Content-Disposition', `inline; filename="${encodeURIComponent(k.kayit_no)}.pdf"`).send(pdf);
  });
}
