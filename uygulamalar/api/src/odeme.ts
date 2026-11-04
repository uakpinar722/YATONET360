import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import { bildir } from './bildirim.js';
import { izYaz } from './denetim.js';
import { dosyaErisimi } from './dosya.js';
import { rolId } from './ihbar.js';
import { kartAc } from './is_motoru.js';
import { kapanisKaydet } from './kapanis.js';
import { tamOturumGerekli, type Baglam } from './kimlik.js';
import { gunAy, metinGetir, tutar } from './metin.js';
import { sayac } from './sure.js';
import { parasalZincir, parametre, sonMakam } from './teklif.js';
import { firmaOdemePlani, hakedisSonuc, tahsilatOrani } from './ticari.js';
import { UUID } from './yat.js';
import { blokeEngeli } from './alacak.js';

type Db = Pool | PoolClient;
const R2 = (x: number) => Math.round(Number((x * 100).toPrecision(12))) / 100;
const MFM = 'Muhasebe ve Finans Müdürü'; const MFMY = 'Muhasebe ve Finans Müdür Yardımcısı'; const TID = 'Ticari İşler Direktörü'; const GMY = 'Genel Müdür Yardımcısı';
const TICARI = 'Muhasebe ve Finans Sorumlusu (Ticari Sorumlu)';
const MUHASEBE = [TICARI, 'Muhasebe ve Finans Yöneticisi', MFM];
const MAHSUP_HAZIRLAYAN = [...MUHASEBE, 'Firma Yönetimi Müdürü', 'Teknik Uzman'];
const MAHSUP_TURLERI = ['Garanti Masrafı', 'Başka Firmaya Verilen Zarar', 'Çevre Cezası', 'Kusur Cezası', 'Temizlik Bedeli', 'İşi Bırakma Maliyet Farkı'];
const ACIL_SINIR = 5000;
const firmaKisileri = async (db: Db, kurulus: string) => (await db.query(`SELECT kullanici_ref FROM kurulus_kullanici WHERE kurulus_ref = $1`, [kurulus])).rows.map((r) => r.kullanici_ref as string);
const kartKararcilari = async (db: Db, tur: string, nesne: string) => (await db.query(`SELECT DISTINCT a.yapan_ref FROM is_karti_adim a JOIN is_karti k ON k.kimlik = a.is_ref WHERE k.tur = $1 AND k.nesne_kimligi = $2`, [tur, nesne])).rows.map((r) => r.yapan_ref as string);

/** YG-830: ödeme listesini hazırlayan, onaylayan ve bankada işlem yapan farklı kişidir. */
export async function listeEngeli(db: Db, kullanici: string, listeRef: string | null): Promise<string | null> {
  const l = listeRef ? (await db.query(`SELECT durum, hazirlayan_ref FROM odeme_listesi WHERE kimlik = $1`, [listeRef])).rows[0] : null;
  if (!l || !['Onaylandı', 'Tamamlandı'].includes(l.durum)) return 'Ödeme Listesi onayı bekleniyor.';
  if (l.hazirlayan_ref === kullanici || (await kartKararcilari(db, 'Ödeme Listesi', listeRef!)).includes(kullanici)) return 'Listeyi hazırlayan veya onaylayan kişi ödemeyi kaydedemez; başka bir yetkiliden işlem bekleniyor.';
  return null;
}
export async function listeTamamla(c: Db, listeRef: string | null) {
  if (!listeRef) return;
  await c.query(`UPDATE odeme_listesi l SET durum = 'Tamamlandı' WHERE l.kimlik = $1 AND NOT EXISTS (SELECT 1 FROM odeme_talimati t WHERE t.odeme_listesi_ref = l.kimlik AND t.durum <> 'Ödendi') AND NOT EXISTS (SELECT 1 FROM tedarikci_faturasi f WHERE f.odeme_listesi_ref = l.kimlik AND f.odeme_zamani IS NULL)`, [listeRef]);
}

kapanisKaydet('Ödeme Listesi', async (c, k, karar) => {
  if (karar === 'Onayla') await c.query(`UPDATE odeme_listesi SET durum = 'Onaylandı' WHERE kimlik = $1::uuid`, [k.nesne_kimligi]);
  else if (karar === 'Reddet') {
    await c.query(`UPDATE odeme_listesi SET durum = 'Reddedildi' WHERE kimlik = $1::uuid`, [k.nesne_kimligi]);
    await c.query(`UPDATE odeme_talimati SET odeme_listesi_ref = NULL WHERE odeme_listesi_ref = $1::uuid`, [k.nesne_kimligi]);
    await c.query(`UPDATE tedarikci_faturasi SET odeme_listesi_ref = NULL WHERE odeme_listesi_ref = $1::uuid`, [k.nesne_kimligi]);
  }
});
kapanisKaydet('Acil Ödeme İstisnası', async (c, k, karar) => {
  if (karar === 'Onayla') await c.query(`UPDATE odeme_talimati SET acil_onayli = true WHERE kimlik = $1::uuid`, [k.nesne_kimligi]);
});
kapanisKaydet('Hakediş Mahsubu', async (c, k, karar) => {
  if (karar === 'Onayla') {
    const m = (await c.query(`UPDATE hakedis_mahsubu SET statu = 'Onaylandı', kalan_eur = tutar_eur WHERE kimlik = $1::uuid RETURNING kurulus_ref, tur, tutar_eur`, [k.nesne_kimligi])).rows[0];
    if (m) await bildir(c, { olay: `mahsup:${k.nesne_kimligi}`, kullanicilar: await firmaKisileri(c, m.kurulus_ref), baslik: `Hakediş Mahsubu: ${m.tur}`, ozet: `${tutar(Number(m.tutar_eur))} EUR` });
  } else if (karar === 'Reddet') await c.query(`UPDATE hakedis_mahsubu SET statu = 'Reddedildi' WHERE kimlik = $1::uuid`, [k.nesne_kimligi]);
});
kapanisKaydet('Malzeme Avansı', async (c, k, karar, yapan) => {
  if (karar === 'Onayla') {
    const a = (await c.query(`UPDATE firma_malzeme_avansi SET durum = 'Onaylandı' WHERE kimlik = $1::uuid RETURNING *`, [k.nesne_kimligi])).rows[0];
    if (a) await c.query(`INSERT INTO odeme_talimati (avans_ref, kurulus_ref, tutar_eur, planlanan_tarih, tahsilata_bagli, durum, hazirlayan_ref) VALUES ($1,$2,$3,current_date,true,'Onaylandı',$4)`, [a.kimlik, a.kurulus_ref, a.tutar_eur, a.hazirlayan_ref ?? yapan]);
  } else if (karar === 'Reddet') await c.query(`UPDATE firma_malzeme_avansi SET durum = 'Reddedildi' WHERE kimlik = $1::uuid`, [k.nesne_kimligi]);
});

export function odemeYollari(s: FastifyInstance, b: Baglam) {
  const oturumlu = { preHandler: tamOturumGerekli(b) };
  const yok = (y: FastifyReply) => y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' });
  const rolVar = async (k: string, roller: string[]) => Boolean((await b.db.query(`SELECT 1 FROM rol_atamasi a JOIN rol r ON r.kimlik = a.rol_ref WHERE a.kullanici_ref = $1 AND a.atama_durumu = 'Aktif' AND r.rol_adi = ANY($2::text[]) LIMIT 1`, [k, roller])).rowCount);
  const islem = async <T>(f: (c: PoolClient) => Promise<T>) => { const c = await b.db.connect(); try { await c.query('BEGIN'); const r = await f(c); await c.query('COMMIT'); return r; } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); } };
  const tarihTr = (d: Date) => d.toISOString().slice(0, 10).split('-').reverse().join('.');

  // YG-843, V-131: plan güncel tahsilat tarihinden hesaplanır; azami gün ilk talimat tarihinden işler.
  const plan = async (dosya: string, baslangic: Date) => {
    const th = (await b.db.query(`SELECT max(tarih) t FROM tahsilat WHERE dosya_ref = $1`, [dosya])).rows[0].t;
    return firmaOdemePlani(th ? new Date(th) : null, baslangic, await parametre(b.db, 'firma_odeme_gun'), await parametre(b.db, 'firma_odeme_azami_gun'));
  };
  const talimatlar = async (kosul: string) => (await b.db.query(`SELECT t.kimlik, t.tutar_eur, t.mahsup_eur, t.tutulan_eur, t.durum, t.olusturma_zamani, t.odeme_listesi_ref, t.acil_onayli, t.avans_ref, h.hakedis_no, h.dosya_ref AS h_dosya, a.dosya_ref AS a_dosya, h.firma_fatura_no, u.ticari_unvan, l.liste_no, l.durum AS liste_durumu FROM odeme_talimati t LEFT JOIN hakedis h ON h.kimlik = t.hakedis_ref LEFT JOIN firma_malzeme_avansi a ON a.kimlik = t.avans_ref JOIN kurulus u ON u.kimlik = t.kurulus_ref LEFT JOIN odeme_listesi l ON l.kimlik = t.odeme_listesi_ref WHERE ${kosul} ORDER BY t.olusturma_zamani`)).rows;

  s.get('/firma-odemeleri', oturumlu, async (i, y) => {
    if (!(await rolVar(i.oturum!.kullanici, MUHASEBE))) return yok(y);
    return Promise.all((await talimatlar(`t.durum = 'Onaylandı'`)).map(async (x) => {
      const p = x.h_dosya ? await plan(x.h_dosya, x.olusturma_zamani) : { tarih: x.olusturma_zamani as Date, tahsilataBagli: true };
      const th = x.h_dosya ? Boolean((await b.db.query(`SELECT 1 FROM tahsilat WHERE dosya_ref = $1 LIMIT 1`, [x.h_dosya])).rowCount) : true;
      return { kimlik: x.kimlik, tutar_eur: x.tutar_eur, mahsup_eur: x.mahsup_eur, tutulan_eur: x.tutulan_eur, belge_no: x.hakedis_no ?? 'Malzeme Avansı', firma_fatura_no: x.firma_fatura_no, ticari_unvan: x.ticari_unvan, plan: p.tarih.toISOString().slice(0, 10), tahsilataBagli: p.tahsilataBagli, durumAdi: th ? 'Vade İşliyor' : 'Tahsilat Bekleniyor', liste_no: x.liste_no, liste_durumu: x.liste_durumu, acil_onayli: x.acil_onayli }; // YG-844
    }));
  });

  // YG-830: mükerrerlik uyarısı çözülmeden liste onaya gitmez.
  s.post('/odeme-listesi', oturumlu, async (i, y) => {
    const o = i.oturum!; const g = (i.body ?? {}) as { talimatlar?: string[]; faturalar?: string[]; mukerrerlikCozumu?: string };
    if (!(await rolVar(o.kullanici, MUHASEBE))) return yok(y);
    const tl = g.talimatlar ?? []; const fl = g.faturalar ?? [];
    if (!tl.length && !fl.length) return y.code(400).send({ hata: 'Listeye en az bir ödeme eklemenizi rica ederiz.' });
    if ([...tl, ...fl].some((x) => !UUID.test(x))) return yok(y);
    const uyari: string[] = []; let toplam = 0;
    for (const id of tl) {
      const t = (await talimatlar(`t.kimlik = '${id}'`))[0];
      if (!t || t.durum !== 'Onaylandı' || t.odeme_listesi_ref) return y.code(409).send({ hata: 'Listeye yalnız onaylı ve listeye alınmamış talimat eklenir.' });
      if (t.h_dosya) { const p = await plan(t.h_dosya, t.olusturma_zamani); if (p.tarih.getTime() > Date.now()) return y.code(409).send({ hata: `${t.hakedis_no} için ödeme planı tarihi ${tarihTr(p.tarih)} olup bu tarih bekleniyor.` }); }
      toplam += Number(t.tutar_eur);
      if ((await b.db.query(`SELECT 1 FROM odeme_talimati x JOIN odeme_talimati y ON y.kimlik = $1 WHERE x.kimlik <> y.kimlik AND x.kurulus_ref = y.kurulus_ref AND x.tutar_eur = y.tutar_eur AND coalesce(x.odeme_zamani, now()) > now() - interval '120 days' AND (x.durum = 'Ödendi' OR x.odeme_listesi_ref IS NOT NULL OR x.kimlik = ANY($2::uuid[])) LIMIT 1`, [id, tl])).rowCount) uyari.push(t.ticari_unvan);
    }
    for (const id of fl) {
      const f = (await b.db.query(`SELECT f.fatura_no, f.tutar_eur, f.odeme_zamani, f.odeme_listesi_ref, f.kurulus_ref, (SELECT e.sonuc FROM uclu_eslestirme e WHERE e.siparis_ref = f.siparis_ref AND e.fatura_no = f.fatura_no LIMIT 1) AS eslestirme FROM tedarikci_faturasi f WHERE f.kimlik = $1`, [id])).rows[0];
      if (!f || f.odeme_zamani || f.odeme_listesi_ref || f.eslestirme !== 'Eşleşti') return y.code(409).send({ hata: 'Listeye yalnız üçlü eşleşmesi tamamlanmış ve ödenmemiş fatura eklenir.' });
      toplam += Number(f.tutar_eur);
    }
    if (uyari.length && !g.mukerrerlikCozumu?.trim()) return y.code(409).send({ hata: `Mükerrerlik uyarısı: ${[...new Set(uyari)].join(', ')} için aynı tutarda ödeme bulunmaktadır; inceleme sonucunu yazmanızı rica ederiz.`, mukerrerlik: true });
    return islem(async (c) => {
      const no = `LGM-OD-${String(await sayac(c, 'odeme-listesi')).padStart(5, '0')}`;
      const l = (await c.query(`INSERT INTO odeme_listesi (liste_no, mukerrerlik_cozumu, hazirlayan_ref) VALUES ($1,$2,$3) RETURNING kimlik`, [no, g.mukerrerlikCozumu?.trim() || null, o.kullanici])).rows[0];
      if (tl.length) await c.query(`UPDATE odeme_talimati SET odeme_listesi_ref = $1 WHERE kimlik = ANY($2::uuid[])`, [l.kimlik, tl]);
      if (fl.length) await c.query(`UPDATE tedarikci_faturasi SET odeme_listesi_ref = $1 WHERE kimlik = ANY($2::uuid[])`, [l.kimlik, fl]);
      await kartAc(c, { tur: 'Ödeme Listesi', baslik: `${no} · Ödeme Listesi`, ozet: `${tutar(R2(toplam))} EUR · ${tl.length + fl.length} ödeme`, hazirlayan: o.kullanici, zincir: await parasalZincir(c, [MFMY], TID), nesneTuru: 'Ödeme Listesi', nesneKimligi: l.kimlik });
      return { kimlik: l.kimlik, listeNo: no };
    });
  });

  // YG-833: listeyi ve plan tarihini beklemeyen ödeme; en çok 5.000,00 EUR, sırayla GMY ve Muhasebe ve Finans Müdürü.
  s.post('/odeme-talimati/:id/acil', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const gerekce = ((i.body ?? {}) as { gerekce?: string }).gerekce?.trim();
    if (!UUID.test(id) || !(await rolVar(o.kullanici, MUHASEBE))) return yok(y);
    const t = (await talimatlar(`t.kimlik = '${id}'`))[0];
    if (!t) return yok(y);
    if (t.durum !== 'Onaylandı' || t.odeme_listesi_ref) return y.code(409).send({ hata: 'Acil istisna yalnız onaylı ve listeye alınmamış talimat için istenir.' });
    if (Number(t.tutar_eur) > ACIL_SINIR) return y.code(409).send({ hata: 'Acil ödeme istisnası en çok 5.000,00 EUR için uygulanır.' });
    if (!gerekce) return y.code(400).send({ hata: 'Acil ödeme gerekçesini yazmanızı rica ederiz.' });
    if ((await b.db.query(`SELECT 1 FROM is_karti WHERE tur = 'Acil Ödeme İstisnası' AND nesne_kimligi = $1 LIMIT 1`, [id])).rowCount) return y.code(409).send({ hata: 'Bu talimat için istisna talebi bulunmaktadır.' });
    return islem(async (c) => {
      await c.query(`UPDATE odeme_talimati SET acil_gerekce = $2 WHERE kimlik = $1`, [id, gerekce]);
      await kartAc(c, { tur: 'Acil Ödeme İstisnası', baslik: `${t.hakedis_no ?? 'Malzeme Avansı'} · Acil Ödeme İstisnası`, ozet: `${tutar(Number(t.tutar_eur))} EUR · ${gerekce}`, hazirlayan: o.kullanici, zincir: [await rolId(c, GMY), await rolId(c, MFM)], nesneTuru: 'Ödeme Talimatı', nesneKimligi: id });
      return { durum: 'Onayda' };
    });
  });

  // YG-830, YG-827, V-131: banka referansıyla kayıt; başarısız ödeme borcu kapatmaz, kayıt yalnız gerçekleşince girilir.
  s.post('/firma-odemeleri/:id/odendi', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const referans = ((i.body ?? {}) as { referans?: string }).referans?.trim();
    if (!UUID.test(id) || !(await rolVar(o.kullanici, MUHASEBE))) return yok(y);
    const t = (await b.db.query(`SELECT t.*, h.dosya_ref, h.hakedis_no, h.net, h.firma_fatura_no, h.firma_fatura_kuru, e.teknik_kabul_eden_ref, a.dosya_ref AS avans_dosya FROM odeme_talimati t LEFT JOIN hakedis h ON h.kimlik = t.hakedis_ref LEFT JOIN is_emri e ON e.kimlik = h.is_emri_ref LEFT JOIN firma_malzeme_avansi a ON a.kimlik = t.avans_ref WHERE t.kimlik = $1`, [id])).rows[0];
    if (!t) return yok(y);
    if (t.durum !== 'Onaylandı') return y.code(409).send({ hata: 'Ödeme talimatı onaylı değildir.' });
    { const bl = await blokeEngeli(b.db, t.kurulus_ref); if (bl) return y.code(409).send({ hata: bl }); } // YG-915
    if (!referans) return y.code(400).send({ hata: 'Banka işlem referansını yazmanızı rica ederiz.' });
    const onay = [...await kartKararcilari(b.db, 'Firma Ödeme Talimatı', id), ...await kartKararcilari(b.db, 'Acil Ödeme İstisnası', id), ...(t.avans_ref ? await kartKararcilari(b.db, 'Malzeme Avansı', t.avans_ref) : [])];
    if (o.kullanici === t.hazirlayan_ref || onay.includes(o.kullanici) || o.kullanici === t.teknik_kabul_eden_ref) return y.code(409).send({ hata: 'Talimatı hazırlayan, onaylayan veya teknik kabulü veren kişi ödemeyi kaydedemez; başka bir yetkiliden işlem bekleniyor.' });
    if (!t.acil_onayli) { const le = await listeEngeli(b.db, o.kullanici, t.odeme_listesi_ref); if (le) return y.code(409).send({ hata: le }); }
    if (!(await b.db.query(`SELECT 1 FROM banka_hesabi WHERE kurulus_ref = $1 AND durum = 'Geçerli'`, [t.kurulus_ref])).rowCount) return y.code(409).send({ hata: 'Firmanın teyitli banka hesabı bekleniyor.' }); // YG-928
    if (t.dosya_ref && !t.acil_onayli) {
      const p = await plan(t.dosya_ref, t.olusturma_zamani);
      if (p.tarih.getTime() > Date.now()) return y.code(409).send({ hata: `Ödeme planı tarihi ${tarihTr(p.tarih)} olup bu tarih bekleniyor.` });
      if (p.tahsilataBagli) { // YG-843: kısmi tahsilatta ödeme bu oranda
        const once = Number((await b.db.query(`SELECT coalesce(sum(tutar_eur + mahsup_eur), 0) t FROM odeme_talimati WHERE hakedis_ref = $1 AND durum = 'Ödendi'`, [t.hakedis_ref])).rows[0].t);
        if (R2(once + Number(t.tutar_eur) + Number(t.mahsup_eur)) > R2(Number(t.net) * await tahsilatOrani(b.db, t.dosya_ref))) return y.code(409).send({ hata: 'Ödeme tahsilat oranını aşıyor; kalan tahsilat bekleniyor.' });
      }
    }
    if ((await b.db.query(`SELECT 1 FROM odeme_talimati WHERE banka_referansi = $1`, [referans])).rowCount) return y.code(409).send({ hata: 'Bu banka referansıyla kayıt vardır; mükerrer ödeme engellendi.' });
    await islem(async (c) => {
      await c.query(`UPDATE odeme_talimati SET durum = 'Ödendi', odeyen_ref = $2, odeme_zamani = now(), banka_referansi = $3 WHERE kimlik = $1`, [id, o.kullanici, referans]);
      if (t.hakedis_ref) await hakedisSonuc(c, t.hakedis_ref);
      if (t.avans_ref) { // YG-842: ödenen avans sonraki hakedişten düşülür
        await c.query(`UPDATE firma_malzeme_avansi SET durum = 'Ödendi' WHERE kimlik = $1`, [t.avans_ref]);
        await c.query(`INSERT INTO hakedis_mahsubu (kurulus_ref, dosya_ref, tur, tutar_eur, kalan_eur, aciklama, statu, hazirlayan_ref) VALUES ($1,$2,'Malzeme Avansı',$3,$3,'Ödenen malzeme avansı','Onaylandı',$4)`, [t.kurulus_ref, t.avans_dosya, t.tutar_eur, o.kullanici]);
      }
      await listeTamamla(c, t.odeme_listesi_ref);
      await bildir(c, { olay: `firma-odeme:${id}`, kullanicilar: await firmaKisileri(c, t.kurulus_ref), baslik: `${t.hakedis_no ?? 'Malzeme Avansı'} Ödendi`, ozet: t.firma_fatura_no && t.firma_fatura_kuru ? await metinGetir(c, 'BLD-81', 'tr', { 'fatura no': t.firma_fatura_no, tutar: tutar(R2(Number(t.tutar_eur) * Number(t.firma_fatura_kuru))), tarih: gunAy(new Date()) }) : null }); // BLD-81 portal bildirimi
      await izYaz(c, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Firma Ödemesi', nesneTuru: 'Ödeme Talimatı', nesneKimligi: id, yeni: { referans }, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    });
    return { durum: 'Ödendi' };
  });

  // YG-840, YG-1418, YG-353: belgeli mahsup önerisi; onaydan sonra firmanın sonraki ödemesinden düşülür.
  s.post('/dosya/:id/mahsup', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { kurulus?: string; tur?: string; tutar?: number; belge?: string; aciklama?: string };
    if (!UUID.test(id) || !(await dosyaErisimi(b.db, o.kullanici, id))) return yok(y);
    if (!(await rolVar(o.kullanici, MAHSUP_HAZIRLAYAN))) return y.code(403).send({ hata: 'Mahsup önerisini muhasebe kadrosu, Firma Yönetimi Müdürü veya Teknik Uzman hazırlar.' });
    if (!MAHSUP_TURLERI.includes(g.tur ?? '') || !(Number(g.tutar) > 0) || !g.aciklama?.trim()) return y.code(400).send({ hata: 'Tür, tutar ve açıklamayı girmenizi rica ederiz.' });
    if (!g.belge || !UUID.test(g.belge)) return y.code(400).send({ hata: g.tur === 'Başka Firmaya Verilen Zarar' ? 'Devir fotoğrafını eklemenizi rica ederiz.' : 'Dayanak belgeyi eklemenizi rica ederiz.' });
    if (!g.kurulus || !UUID.test(g.kurulus) || !(await b.db.query(`SELECT 1 FROM is_emri WHERE dosya_ref = $1 AND kurulus_ref = $2 LIMIT 1`, [id, g.kurulus])).rowCount) return y.code(400).send({ hata: 'Bu dosyada iş emri olan firmayı seçmenizi rica ederiz.' });
    return islem(async (c) => {
      const m = (await c.query(`INSERT INTO hakedis_mahsubu (kurulus_ref, dosya_ref, tur, tutar_eur, belge_ref, aciklama, hazirlayan_ref) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING kimlik`, [g.kurulus, id, g.tur, g.tutar, g.belge, g.aciklama!.trim(), o.kullanici])).rows[0];
      await kartAc(c, { tur: 'Hakediş Mahsubu', baslik: `${g.tur} · Hakediş Mahsubu`, ozet: `${tutar(Number(g.tutar))} EUR · ${g.aciklama!.trim()}`, hazirlayan: o.kullanici, zincir: await parasalZincir(c, [MFM], await sonMakam(c, Number(g.tutar))), nesneTuru: 'Hakediş Mahsubu', nesneKimligi: m.kimlik });
      return { kimlik: m.kimlik };
    });
  });

  // YG-842: firmaya malzeme avansı yalnız müşteriden tahsil edilen tutar kadar; onay TİD (YG-1613).
  s.post('/is-emri/:id/malzeme-avansi', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { tutar?: number; gerekce?: string };
    if (!UUID.test(id)) return yok(y);
    const e = (await b.db.query(`SELECT e.dosya_ref, e.kurulus_ref, e.is_emri_no FROM is_emri e WHERE e.kimlik = $1`, [id])).rows[0];
    if (!e || !(await dosyaErisimi(b.db, o.kullanici, e.dosya_ref))) return yok(y);
    if (!(await rolVar(o.kullanici, [TICARI]))) return y.code(403).send({ hata: 'Malzeme avansını Ticari Sorumlu hazırlar.' });
    if (!(Number(g.tutar) > 0) || !g.gerekce?.trim()) return y.code(400).send({ hata: 'Tutar ve gerekçeyi girmenizi rica ederiz.' });
    const th = Number((await b.db.query(`SELECT coalesce(sum(tutar_eur), 0) t FROM tahsilat WHERE dosya_ref = $1`, [e.dosya_ref])).rows[0].t);
    const ver = Number((await b.db.query(`SELECT coalesce(sum(tutar_eur), 0) t FROM firma_malzeme_avansi WHERE dosya_ref = $1 AND durum <> 'Reddedildi'`, [e.dosya_ref])).rows[0].t);
    if (R2(ver + Number(g.tutar)) > th) return y.code(409).send({ hata: `Malzeme avansı müşteriden tahsil edilen tutarı aşamaz; kullanılabilir tutar ${tutar(R2(Math.max(0, th - ver)))} EUR.` });
    return islem(async (c) => {
      const a = (await c.query(`INSERT INTO firma_malzeme_avansi (is_emri_ref, dosya_ref, kurulus_ref, tutar_eur, gerekce, hazirlayan_ref) VALUES ($1,$2,$3,$4,$5,$6) RETURNING kimlik`, [id, e.dosya_ref, e.kurulus_ref, g.tutar, g.gerekce!.trim(), o.kullanici])).rows[0];
      await kartAc(c, { tur: 'Malzeme Avansı', baslik: `${e.is_emri_no} · Malzeme Avansı`, ozet: `${tutar(Number(g.tutar))} EUR`, hazirlayan: o.kullanici, zincir: await parasalZincir(c, [], TID), nesneTuru: 'Malzeme Avansı', nesneKimligi: a.kimlik });
      return { kimlik: a.kimlik };
    });
  });
}
