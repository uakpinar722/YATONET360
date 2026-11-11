import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Pool } from 'pg';
import { tamOturumGerekli, type Baglam } from './kimlik.js';
import { kullaniciIzinleri } from './yetki.js';

type Rol = { rol_adi: string; kademe: string; birim: string };
const TEDARIK = ['Tedarik Sorumlusu', 'Tedarik Yöneticisi', 'Tedarik Müdür Yardımcısı', 'Tedarik Yönetimi Müdürü'];
const BITMIS = ['Tamamlandı', 'Kapalı', 'İptal', 'Yerine Geçti'];
const BASLAMAMIS = ['Taslak', 'İç Onayda', 'Kabul Bekliyor', 'Başlangıç Kontrolünde'];
const GUN = 86_400_000;
const roller = async (db: Pool, k: string): Promise<Rol[]> => (await db.query(`SELECT r.rol_adi, r.kademe, r.rol_sahibi_birim birim FROM rol_atamasi a JOIN rol r ON r.kimlik = a.rol_ref WHERE a.kullanici_ref = $1 AND a.atama_durumu = 'Aktif'`, [k])).rows;
const ustYonetim = (r: Rol) => r.birim === 'Üst Yönetim' || r.kademe === 'Direktör' || r.rol_adi === 'Genel Müdür Yardımcısı' || r.rol_adi === 'CEO';
/** YG-811, YG-364: firma adı yalnız Firma Yönetimi, Operasyon ve üst yönetime görünür. */
export const firmaAdiGorur = (l: Rol[]) => l.some((r) => ['Firma Yönetimi Müdürlüğü', 'Operasyon Müdürlüğü'].includes(r.birim) || ustYonetim(r) || r.rol_adi === 'Bilgi Teknolojileri ve Firma Yönetimi Direktörü');
const tumIsler = (l: Rol[]) => l.some((r) => ['Operasyon Müdürlüğü', 'Teknik Müdürlük', 'Firma Yönetimi Müdürlüğü'].includes(r.birim) || ustYonetim(r));
const tarihStr = (d: Date) => new Date(d.getTime() + 3 * 3_600_000).toISOString().slice(0, 10);

/** YG-812, YG-813: planlanan konum; izin, nöbet ve keşif kayıtlarından kendiliğinden oluşur, elle girilmez. Anlık GPS kullanılmaz. */
export async function konumPlani(db: Pool, kisiler: string[], bugun = new Date()): Promise<{ kimlik: string; ad: string; gunler: { tarih: string; konum: string }[] }[]> {
  const gunler = Array.from({ length: 7 }, (_, n) => tarihStr(new Date(bugun.getTime() + n * GUN)));
  const ilk = gunler[0]!; const son = gunler[6]!;
  const ad = (await db.query(`SELECT kimlik, ad_soyad FROM kullanici_hesabi WHERE kimlik = ANY($1) ORDER BY ad_soyad`, [kisiler])).rows;
  const izin = (await db.query(`SELECT personel_ref k, baslangic::text b, bitis::text s FROM izin_talebi WHERE durum = 'Onaylandı' AND personel_ref = ANY($1) AND bitis >= $2::date AND baslangic <= $3::date`, [kisiler, ilk, son])).rows;
  const nobet = (await db.query(`SELECT v.kullanici_ref k, (v.baslangic AT TIME ZONE 'Europe/Istanbul')::date::text b, (v.bitis AT TIME ZONE 'Europe/Istanbul')::date::text s FROM nobet_vardiyasi v JOIN nobet_cizelgesi c ON c.kimlik = v.cizelge_ref WHERE c.durum = 'Yürürlükte' AND v.kullanici_ref = ANY($1) AND v.bitis >= $2::date AND v.baslangic < $3::date + 1`, [kisiler, ilk, son])).rows;
  const kesif = (await db.query(`SELECT k.sorumlu_ref k, (k.planlanan_baslangic AT TIME ZONE 'Europe/Istanbul')::date::text b, (k.planlanan_bitis AT TIME ZONE 'Europe/Istanbul')::date::text s, d.dosya_no, d.konum FROM kesif k JOIN dosya d ON d.kimlik = k.dosya_ref WHERE k.durum <> 'Durduruldu' AND k.sorumlu_ref = ANY($1) AND k.planlanan_bitis >= $2::date AND k.planlanan_baslangic < $3::date + 1 ORDER BY k.planlanan_baslangic`, [kisiler, ilk, son])).rows;
  const icinde = (t: string, x: { b: string; s: string }) => x.b <= t && t <= x.s;
  return ad.map((p) => ({
    kimlik: p.kimlik, ad: p.ad_soyad,
    gunler: gunler.map((t) => {
      if (izin.some((x) => x.k === p.kimlik && icinde(t, x))) return { tarih: t, konum: 'İzinli' }; // yalnız İzinli yazar
      const ks = kesif.filter((x) => x.k === p.kimlik && icinde(t, x));
      const parca = ks.map((x) => (x.b < t && t < x.s ? `Yolda · ${x.dosya_no}` : `${x.konum} · ${x.dosya_no}`));
      if (nobet.some((x) => x.k === p.kimlik && icinde(t, x))) parca.push('Nöbetçi');
      return { tarih: t, konum: parca.length ? parca.join(' / ') : 'Merkez Ofis' };
    }),
  }));
}

export function isGorunumuYollari(s: FastifyInstance, b: Baglam) {
  const oturumlu = { preHandler: tamOturumGerekli(b) };
  const yok = (y: FastifyReply) => y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' });

  // YG-814–817: iş birimi iş emri; tedarik kolunda sipariş. Listeler iş emri başlangıç, kabul/teslim ve sipariş kayıtlarından oluşur.
  s.get('/is-listeleri', oturumlu, async (i, y) => {
    const o = i.oturum!; if (o.grup !== 'LGM İç Rolü') return yok(y);
    const l = await roller(b.db, o.kullanici); const adGorur = firmaAdiGorur(l);
    const tedarik = l.some((r) => TEDARIK.includes(r.rol_adi));
    const ortalamaKesifDakika = Number((await b.db.query(`SELECT round(avg(extract(epoch FROM saha_cikis_zamani - kesif_tarihi) / 60))::int d FROM kesif WHERE durum = 'Tamamlandı' AND kesif_tarihi IS NOT NULL AND saha_cikis_zamani > kesif_tarihi`)).rows[0].d ?? 0) || null; // YG-818
    if (tedarik) {
      const sp = (await b.db.query(`SELECT s.kimlik, s.siparis_no, d.dosya_no, x.yat_adi, k.ticari_unvan tedarikci, s.statu, s.teslim_tarihi::text, (SELECT max(m.bekletme_baslangic) FROM malzeme_giris_kabulu m WHERE m.siparis_ref = s.kimlik) teslim_zamani, h.ad_soyad sorumlu FROM tedarik_siparisi s JOIN dosya d ON d.kimlik = s.dosya_ref JOIN yat x ON x.kimlik = d.yat_ref JOIN kurulus k ON k.kimlik = s.kurulus_ref JOIN kullanici_hesabi h ON h.kimlik = s.hazirlayan_ref WHERE s.statu <> 'İptal' ORDER BY s.teslim_tarihi`)).rows;
      const simdi = Date.now();
      return {
        tur: 'Sipariş', ortalamaKesifDakika,
        tamamlanan: sp.filter((x) => ['Teslim Alındı', 'Kapalı'].includes(x.statu) && x.teslim_zamani && simdi - +new Date(x.teslim_zamani) <= 3 * GUN),
        devamEden: sp.filter((x) => ['Verildi', 'Kısmi Teslim'].includes(x.statu)).map((x) => ({ ...x, gecikti: x.teslim_tarihi < tarihStr(new Date()) })).sort((a, c) => Number(c.gecikti) - Number(a.gecikti)),
        planli: sp.filter((x) => ['Taslak', 'Onay Bekliyor'].includes(x.statu)),
      };
    }
    const tum = tumIsler(l) || (await kullaniciIzinleri(b.db, o.kullanici)).includes('dosya.tum');
    const ie = (await b.db.query(`SELECT e.kimlik, e.is_emri_no, e.statu, d.dosya_no, d.kimlik dosya, x.yat_adi, k.ticari_unvan cozum_ortagi, d.ana_teknik_brans brans, h.ad_soyad sorumlu, e.baslangic_tarihi::text baslangic, e.hedef_bitis_tarihi::text hedef,
        coalesce((SELECT max(a.olusturma_zamani) FROM kabul_kaydi a WHERE a.is_emri_ref = e.kimlik AND a.kabul_turu IN ('Teknik Kabul', 'Koşullu Kabul', 'Nihai Kabul')), (SELECT max(t.teslim_zamani) FROM teslim_kaydi t WHERE t.dosya_ref = d.kimlik AND t.durum LIKE 'Teslim Edildi%'), e.kapanis_zamani) tamamlanma
      FROM is_emri e JOIN dosya d ON d.kimlik = e.dosya_ref JOIN yat x ON x.kimlik = d.yat_ref JOIN kurulus k ON k.kimlik = e.kurulus_ref LEFT JOIN kullanici_hesabi h ON h.kimlik = d.dosya_sorumlusu_ref
      WHERE e.statu NOT IN ('İptal', 'Yerine Geçti') AND NOT EXISTS (SELECT 1 FROM is_emri n WHERE n.is_emri_no = e.is_emri_no AND n.surum > e.surum)
        AND ($1 OR EXISTS (SELECT 1 FROM dosya_ekibi_atamasi a WHERE a.dosya_ref = d.kimlik AND a.kullanici_ref = $2 AND a.bitis_zamani IS NULL) OR d.dosya_sorumlusu_ref = $2)`, [tum, o.kullanici])).rows
      .map((x) => ({ ...x, cozum_ortagi: adGorur ? x.cozum_ortagi : null }));
    const bugun = tarihStr(new Date()); const simdi = Date.now();
    return {
      tur: 'İş Emri', ortalamaKesifDakika,
      tamamlanan: ie.filter((x) => BITMIS.includes(x.statu) && x.tamamlanma && simdi - +new Date(x.tamamlanma) <= 3 * GUN).sort((a, c) => +new Date(c.tamamlanma) - +new Date(a.tamamlanma)), // YG-815
      devamEden: ie.filter((x) => !BITMIS.includes(x.statu) && !BASLAMAMIS.includes(x.statu) && x.baslangic && x.baslangic <= bugun).map((x) => ({ ...x, gecikti: Boolean(x.hedef && x.hedef < bugun) })).sort((a, c) => Number(c.gecikti) - Number(a.gecikti) || String(a.hedef).localeCompare(String(c.hedef))), // YG-816
      planli: ie.filter((x) => !BITMIS.includes(x.statu) && (BASLAMAMIS.includes(x.statu) || !x.baslangic || x.baslangic > bugun)).sort((a, c) => (a.baslangic ? (c.baslangic ? a.baslangic.localeCompare(c.baslangic) : -1) : 1)), // YG-817: belirsiz olanlar sonda
    };
  });

  // YG-812: kişinin kendisi, amirleri (aynı birimde Müdür ve üstü), Operasyon ve Teknik Müdürlükleri, GMY ve CEO görür; dış kullanıcı göremez.
  s.get('/konum-plani', oturumlu, async (i, y) => {
    const o = i.oturum!; if (o.grup !== 'LGM İç Rolü') return yok(y);
    const l = await roller(b.db, o.kullanici);
    const genel = l.some((r) => ['Operasyon Müdürlüğü', 'Teknik Müdürlük'].includes(r.birim) || r.rol_adi === 'Genel Müdür Yardımcısı' || r.rol_adi === 'CEO');
    const amirBirim = l.filter((r) => ['Müdür', 'Direktör'].includes(r.kademe)).map((r) => r.birim);
    const kisiler = (await b.db.query(`SELECT DISTINCT h.kimlik FROM kullanici_hesabi h JOIN rol_atamasi a ON a.kullanici_ref = h.kimlik AND a.atama_durumu = 'Aktif' JOIN rol r ON r.kimlik = a.rol_ref WHERE h.kullanici_grubu = 'LGM İç Rolü' AND h.hesap_durumu = 'Aktif' AND ($1 OR h.kimlik = $2 OR r.rol_sahibi_birim = ANY($3::text[]))`, [genel, o.kullanici, amirBirim])).rows.map((r) => r.kimlik as string);
    return { kisiler: await konumPlani(b.db, kisiler.length ? kisiler : [o.kullanici]) };
  });

  // YG-810, YG-811: dosya haritası; konum bağlama noktasıyla eşleşir, bölge özetleri ve dosya özet kartı. Sigorta kullanıcısı yalnız kendi dosyalarını görür.
  s.get('/dosya-haritasi', oturumlu, async (i, y) => {
    const o = i.oturum!;
    let kosul = 'false'; const p: unknown[] = [];
    if (o.grup === 'LGM İç Rolü') {
      const l = await roller(b.db, o.kullanici);
      const tum = tumIsler(l) || (await kullaniciIzinleri(b.db, o.kullanici)).includes('dosya.tum');
      p.push(tum, o.kullanici); kosul = `($1 OR EXISTS (SELECT 1 FROM dosya_ekibi_atamasi a WHERE a.dosya_ref = d.kimlik AND a.kullanici_ref = $2 AND a.bitis_zamani IS NULL))`;
    } else if (o.grup.startsWith('Sigorta')) {
      const sir = (await b.db.query(`SELECT sigortaci_adi FROM sigorta_kullanici WHERE kullanici_ref = $1`, [o.kullanici])).rows[0]?.sigortaci_adi ?? '';
      p.push(sir, o.kullanici); kosul = `(lower(s.sigortaci_adi) = lower($1) OR EXISTS (SELECT 1 FROM dosya_tarafi e WHERE e.dosya_ref = d.kimlik AND e.taraf_rolu = 'Eksper' AND e.kullanici_ref = $2 AND e.aktif))`;
    } else return yok(y);
    const lgm = o.grup === 'LGM İç Rolü';
    const rows = (await b.db.query(`SELECT d.kimlik, d.dosya_no, d.statu, d.oncelik, d.tahmini_teslim_tarihi::text hedef, h.ad_soyad sorumlu, d.guncelleme_zamani son_islem,
        EXISTS (SELECT 1 FROM beklemede_isareti x WHERE x.dosya_ref = d.kimlik AND x.kaldirilma_zamani IS NULL) beklemede, n.ad nokta, n.bolge, n.enlem::float8 enlem, n.boylam::float8 boylam
      FROM dosya d LEFT JOIN dosya_sigorta_kaydi s ON s.dosya_ref = d.kimlik LEFT JOIN kullanici_hesabi h ON h.kimlik = d.dosya_sorumlusu_ref
        LEFT JOIN LATERAL (SELECT ad, bolge, enlem, boylam FROM baglama_noktasi n WHERE n.enlem IS NOT NULL AND (n.mukerrer_karari IS DISTINCT FROM 'Birleştirildi') AND (lower(d.konum) LIKE '%' || lower(n.ad) || '%' OR lower(n.ad) LIKE '%' || lower(d.konum) || '%') ORDER BY length(n.ad) DESC LIMIT 1) n ON true
      WHERE d.statu IN ('Açılış Kontrolünde', 'Aktif', 'Kontrollü Askıda') AND ${kosul}`, p)).rows;
    const bolgeler = new Map<string, { bolge: string; devamEden: number; beklemede: number; oncelik: Record<string, number> }>();
    for (const r of rows) {
      const k = r.bolge ?? 'Konumu Eşleşmeyen'; const x = bolgeler.get(k) ?? { bolge: k, devamEden: 0, beklemede: 0, oncelik: {} as Record<string, number> };
      x.devamEden++; if (r.beklemede) x.beklemede++; x.oncelik[String(r.oncelik)] = (x.oncelik[String(r.oncelik)] ?? 0) + 1; bolgeler.set(k, x);
    }
    return {
      bolgeler: [...bolgeler.values()].sort((a, c) => c.devamEden - a.devamEden),
      dosyalar: rows.filter((r) => r.enlem != null).map((r) => ({ kimlik: r.kimlik, dosyaNo: r.dosya_no, statu: r.beklemede ? 'Beklemede' : r.statu, oncelik: r.oncelik, sorumlu: lgm ? r.sorumlu : null, sonIslem: r.son_islem, hedef: r.hedef, nokta: r.nokta, bolge: r.bolge, enlem: r.enlem, boylam: r.boylam })),
    };
  });
}
