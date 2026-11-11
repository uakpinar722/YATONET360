import type { FastifyInstance, FastifyReply } from 'fastify';
import { izYaz } from './denetim.js';
import { dosyaErisimi } from './dosya.js';
import { tamOturumGerekli, type Baglam } from './kimlik.js';
import { UUID } from './yat.js';

const SICIL = ['Sicil Sorumlusu', 'Firma Yönetimi Müdürü', 'Firma Yönetimi Müdür Yardımcısı'];
const TEKNIK = ['Teknik Uzman', 'Sorumlu Teknik Uzman (Koordinatör)', 'Teknik Yönetici', 'Teknik Müdür'];
const TEYIT = ['Teyit bekliyor', 'Teyit edildi', 'Bulunamadı'];
/** YG-1533: katalog durumu fotoğraf ve teknik bilgi varlığından kendiliğinden hesaplanır. */
export const katalogDurumu = (foto: boolean, teknik: boolean) => (foto && teknik ? 'Tamam' : !foto && !teknik ? 'Fotoğraf ve teknik eksik' : !foto ? 'Fotoğraf eksik' : 'Teknik eksik');
/** YG-1535: ana veri tür, gövde ve tahrik bilgisinden branş önerisi; öneri kartelanın ana branş adlarıyla eşleşir, uydurulmaz. */
const KURAL: [RegExp, RegExp][] = [
  [/fiber|grp|ctp|kompozit|cam elyaf/i, /kompozit|grp|fiber/i], [/alüminyum|aluminyum/i, /alüminyum/i], [/çelik|celik/i, /çelik/i], [/ahşap|ahsap|tik/i, /ahşap/i],
  [/hp|kw|motor|dizel|benzin|dıştan takma|volvo|yanmar|mercury|suzuki|yamaha/i, /makine|motor|tahrik/i], [/elektrik|akü|batarya|hibrit/i, /elektrik|akü/i],
  [/yelken|sail|ketch|sloop/i, /yelken|arma/i], [/şişme|rib|tender/i, /şişme|rib/i],
];

export function anaVeriEkYollari(s: FastifyInstance, b: Baglam) {
  const oturumlu = { preHandler: tamOturumGerekli(b) };
  const yok = (y: FastifyReply) => y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' });
  const roller = async (k: string) => (await b.db.query(`SELECT x.rol_adi FROM rol_atamasi a JOIN rol x ON x.kimlik = a.rol_ref WHERE a.kullanici_ref = $1 AND a.atama_durumu = 'Aktif'`, [k])).rows.map((r) => r.rol_adi as string);

  // YG-1266: teyit durumu, son teyit tarihi, enlem, boylam kullanıcıya doldurtulur; mükerrer grubu varsa karar önce verilir.
  s.post('/baglama-noktasi/:id/teyit', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; if (!UUID.test(id) || !(await roller(o.kullanici)).some((x) => SICIL.includes(x))) return yok(y);
    const g = (i.body ?? {}) as { teyitDurumu?: string; sonTeyit?: string; enlem?: number; boylam?: number };
    const n = (await b.db.query(`SELECT mukerrer_grubu, mukerrer_karari FROM baglama_noktasi WHERE kimlik = $1`, [id])).rows[0]; if (!n) return yok(y);
    if (!TEYIT.includes(g.teyitDurumu ?? '') || !/^\d{4}-\d{2}-\d{2}$/.test(g.sonTeyit ?? '') || g.sonTeyit! > new Date().toISOString().slice(0, 10)) return y.code(400).send({ hata: 'Teyit durumu ve geçmiş veya bugünkü son teyit tarihi zorunludur.' });
    const en = Number(g.enlem), bo = Number(g.boylam);
    if (g.teyitDurumu === 'Teyit edildi' && !(en >= 35 && en <= 43 && bo >= 25 && bo <= 45.5)) return y.code(400).send({ hata: 'Teyit edilen noktada Türkiye kıyı sınırları içinde enlem ve boylam zorunludur.' });
    if (n.mukerrer_grubu && n.mukerrer_karari === 'Karar bekliyor') return y.code(409).send({ hata: 'Önce olası tekrar (mükerrer) kararını veriniz.' });
    await b.db.query(`UPDATE baglama_noktasi SET teyit_durumu = $2, son_teyit_tarihi = $3, enlem = coalesce($4, enlem), boylam = coalesce($5, boylam) WHERE kimlik = $1`, [id, g.teyitDurumu, g.sonTeyit, Number.isFinite(en) && g.enlem !== undefined ? en : null, Number.isFinite(bo) && g.boylam !== undefined ? bo : null]);
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Bağlama Noktası Teyidi', nesneTuru: 'Bağlama Noktası', nesneKimligi: id, yeni: { teyit: g.teyitDurumu, tarih: g.sonTeyit }, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { tamam: true };
  });

  // YG-1532: katalog fotoğrafı ve teknik bilgi yalnız LGM personeline iç referanstır; dosyayı gören LGM kullanıcısı görür.
  s.get('/dosya/:id/katalog-referansi', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; if (o.grup !== 'LGM İç Rolü' || !UUID.test(id) || !(await dosyaErisimi(b.db, o.kullanici, id))) return yok(y);
    const m = (await b.db.query(`SELECT m.kimlik, m.marka, m.model, m.tekne_turu, m.boy_m, m.govde_malzemesi, m.tahrik_turu, m.katalog_seri, m.katalog_no, m.fotograf, m.teknik_veri, m.durum, m.foto_belge_ref, m.teknik_bilgi, m.bilgi_kaynagi, m.bilgi_zamani
      FROM dosya d JOIN yat y ON y.kimlik = d.yat_ref JOIN yat_marka_model m ON m.kimlik = y.marka_model_ref WHERE d.kimlik = $1`, [id])).rows[0] ?? null;
    let oneri: string[] = [];
    if (m) {
      const metin = [m.tekne_turu, m.govde_malzemesi, m.tahrik_turu].filter(Boolean).join(' ');
      const branslar = (await b.db.query(`SELECT DISTINCT ana_brans FROM kartela_kalemi`)).rows.map((r) => r.ana_brans as string);
      oneri = [...new Set(KURAL.filter(([k]) => k.test(metin)).flatMap(([, h]) => branslar.filter((x) => h.test(x))))];
    }
    return { model: m, bransOnerisi: oneri, teknik: (await roller(o.kullanici)).some((x) => TEKNIK.includes(x)) };
  });
  // YG-1533: Teknik Uzman keşif fotoğrafını ve ruhsat/plaka teknik bilgisini ana veri kaydına işler; durum kendiliğinden güncellenir, kaynak kaydedilir.
  s.post('/dosya/:id/katalog-bilgisi', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string };
    if (!UUID.test(id) || !(await roller(o.kullanici)).some((x) => TEKNIK.includes(x)) || !(await dosyaErisimi(b.db, o.kullanici, id))) return yok(y);
    const g = (i.body ?? {}) as { belge?: string; teknikBilgi?: string; kaynak?: string };
    if (!['Teknik Uzman keşfi', 'Ruhsat / plaka'].includes(g.kaynak ?? '') || (!g.belge && !g.teknikBilgi?.trim())) return y.code(400).send({ hata: 'Kaynak ile fotoğraf veya teknik bilgiden en az biri zorunludur.' });
    if (g.belge && (!UUID.test(g.belge) || !(await b.db.query(`SELECT 1 FROM belge WHERE kimlik = $1 AND bag_turu = 'Dosya' AND bag_kimligi = $2`, [g.belge, id])).rowCount)) return y.code(400).send({ hata: 'Fotoğraf bu dosyaya yüklenmiş bir belge olmalıdır.' });
    const m = (await b.db.query(`SELECT m.kimlik, m.fotograf, m.teknik_veri FROM dosya d JOIN yat y ON y.kimlik = d.yat_ref JOIN yat_marka_model m ON m.kimlik = y.marka_model_ref WHERE d.kimlik = $1`, [id])).rows[0];
    if (!m) return y.code(409).send({ hata: 'Yat bir ana veri modeline bağlı değildir.' });
    const foto = Boolean(g.belge) || m.fotograf === 'Var'; const tek = Boolean(g.teknikBilgi?.trim()) || m.teknik_veri === 'Var';
    await b.db.query(`UPDATE yat_marka_model SET foto_belge_ref = coalesce($2, foto_belge_ref), teknik_bilgi = coalesce($3, teknik_bilgi), fotograf = $4, teknik_veri = $5, durum = $6, bilgi_kaynagi = $7, bilgi_guncelleyen_ref = $8, bilgi_zamani = now(), guncelleme_zamani = now() WHERE kimlik = $1`,
      [m.kimlik, g.belge ?? null, g.teknikBilgi?.trim() || null, foto ? 'Var' : 'Yok', tek ? 'Var' : 'Yok', katalogDurumu(foto, tek), g.kaynak, o.kullanici]);
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Ana Veri Model Bilgisi İşlendi', nesneTuru: 'Yat Marka-Model', nesneKimligi: m.kimlik, yeni: { kaynak: g.kaynak, foto: Boolean(g.belge), teknik: Boolean(g.teknikBilgi) }, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { durum: katalogDurumu(foto, tek) };
  });
}
