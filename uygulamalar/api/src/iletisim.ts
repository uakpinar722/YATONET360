import type { FastifyInstance } from 'fastify';
import { izYaz } from './denetim.js';
import { kapanisKaydet } from './kapanis.js';
import { rolId } from './ihbar.js';
import { kartAc } from './is_motoru.js';
import { tamOturumGerekli, type Baglam } from './kimlik.js';
import { onayMakami, rolSahipleri } from './makam.js';
import { bildir } from './bildirim.js';
import { kullaniciRolleri } from './yetki.js';

const UST_KADEME = new Set(['CEO', 'Genel Müdür Yardımcısı', 'Direktör', 'Müdür']);
const KAPSAM = ['LGM', 'Dış', 'Tümü'];

/** YG-561: dış kapsamlı duyuru üst kademe onayıyla yayımlanır. */
kapanisKaydet('Duyuru Yayımı', async (c, k, karar) => {
  const d = { Onayla: 'Yayında', Reddet: 'Reddedildi', 'Gerekçeyle İade Et': 'İade Edildi', 'Yeniden Gönder': 'Onay Bekliyor' }[karar];
  if (d) await c.query(`UPDATE duyuru SET durum = $2, yayim_zamani = CASE WHEN $2 = 'Yayında' THEN now() ELSE yayim_zamani END WHERE kimlik = $1`, [k.nesne_kimligi, d]);
});

export function iletisimYollari(s: FastifyInstance, b: Baglam) {
  const oturumlu = { preHandler: tamOturumGerekli(b) };

  // YG-560, YG-561: LGM içi duyuruyu Müdür ve üstü doğrudan yayımlar; dış kapsamda bir üst kademe onaylar; CEO onaysızdır.
  // YG-1413, YG-1141: güncelleme sürüm kaydıyla birlikte sürüm notu olarak Duyuru'da yayımlanır (tüm kullanıcılar); acil platform değişikliği sonradan BT ve Firma Yönetimi Direktörü onayına sunulur.
  s.post('/surum-notu', oturumlu, async (i, y) => {
    const o = i.oturum!; const g = (i.body ?? {}) as { surum?: string; notlar?: string; acil?: boolean; bilet?: string };
    const roller = await kullaniciRolleri(b.db, o.kullanici);
    if (o.grup !== 'LGM İç Rolü' || !roller.some((r) => ['Sistem Yöneticisi', 'Bilgi İşlem Müdürü'].includes(r.rol_adi))) return y.code(403).send({ hata: 'Sürüm notunu Sistem Yöneticisi veya Bilgi İşlem Müdürü yayımlar.' });
    if (!g.surum?.trim() || !g.notlar?.trim()) return y.code(400).send({ hata: 'Sürüm numarası ve sürüm notu zorunludur.' });
    if (g.bilet && !/^[0-9a-f-]{36}$/i.test(g.bilet)) return y.code(400).send({ hata: 'Değişiklik bileti geçersizdir.' });
    if ((await b.db.query(`SELECT 1 FROM yazilim_surumu WHERE surum = $1`, [g.surum.trim()])).rowCount) return y.code(409).send({ hata: 'Bu sürüm numarası kayıtlıdır.' });
    const c = await b.db.connect();
    try {
      await c.query('BEGIN');
      const d = (await c.query(`INSERT INTO duyuru (baslik, govde, zorunlu, kapsam, yayimlayan_ref, durum) VALUES ($1,$2,false,'Tümü',$3,'Yayında') RETURNING kimlik`, [`Sürüm ${g.surum.trim()}`, g.notlar.trim(), o.kullanici])).rows[0].kimlik;
      const r = (await c.query(`INSERT INTO yazilim_surumu (surum, notlar, acil, degisiklik_bileti_ref, duyuru_ref, sonradan_onay, yayimlayan_ref) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING kimlik`, [g.surum.trim(), g.notlar.trim(), Boolean(g.acil), g.bilet ?? null, d, g.acil ? 'Onay Bekliyor' : null, o.kullanici])).rows[0].kimlik;
      if (g.acil) await kartAc(c, { tur: 'Acil Platform Değişikliği', baslik: `Sürüm ${g.surum.trim()} · Acil Değişiklik (Sonradan Onay)`, ozet: g.notlar.trim().slice(0, 200), oncelik: 'Yüksek', hazirlayan: o.kullanici, zincir: [await rolId(c, 'Bilgi Teknolojileri ve Firma Yönetimi Direktörü')], nesneTuru: 'Yazılım Sürümü', nesneKimligi: r });
      await c.query('COMMIT');
      return { kimlik: r, duyuru: d };
    } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
  });
  s.get('/surumler', oturumlu, async (i, y) => {
    if (i.oturum!.grup !== 'LGM İç Rolü') return y.code(403).send({ hata: 'Bu işlem için yetkiniz bulunmamaktadır.' });
    return (await b.db.query(`SELECT surum, notlar, acil, sonradan_onay, zaman FROM yazilim_surumu ORDER BY zaman DESC LIMIT 50`)).rows;
  });
  s.post('/duyuru', oturumlu, async (i, y) => {
    const o = i.oturum!;
    if (o.grup !== 'LGM İç Rolü') return y.code(403).send({ hata: 'Bu işlem için yetkiniz bulunmamaktadır.' });
    const { baslik, govde, zorunlu, kapsam, bitis, tur } = (i.body ?? {}) as { baslik?: string; govde?: string; zorunlu?: boolean; kapsam?: string; bitis?: string; tur?: string };
    if (tur !== undefined && !['Genel', 'Özel Gün'].includes(tur)) return y.code(400).send({ hata: 'Duyuru türünü seçiniz.' }); // YG-563
    if (!baslik?.trim() || !kapsam || !KAPSAM.includes(kapsam)) return y.code(400).send({ hata: 'Başlık ve kapsam zorunludur.' });
    const roller = await kullaniciRolleri(b.db, o.kullanici);
    const ceo = roller.some((r) => r.rol_adi === 'CEO');
    const ust = roller.find((r) => UST_KADEME.has(r.kademe));
    const hazirlayabilir = ust || roller.some((r) => r.kademe === 'Müdür Yardımcısı');
    if (!hazirlayabilir) return y.code(403).send({ hata: 'Duyuru yayımlama yetkiniz bulunmamaktadır.' });
    if (kapsam === 'LGM' && !ust) return y.code(403).send({ hata: 'Yalnız LGM personeline yönelik duyuruyu Müdür ve üstü kademe yayımlar.' });
    const dogrudan = ceo || kapsam === 'LGM';
    const c = await b.db.connect();
    try {
      await c.query('BEGIN');
      const { rows } = await c.query(
        `INSERT INTO duyuru (baslik, govde, zorunlu, kapsam, yayimlayan_ref, bitis_zamani, durum, tur) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING kimlik`,
        [baslik.trim(), govde?.trim() || null, Boolean(zorunlu), kapsam, o.kullanici, bitis || null, dogrudan ? 'Yayında' : 'Onay Bekliyor', tur ?? 'Genel']);
      const id = rows[0].kimlik as string;
      if (!dogrudan) {
        const kart = await kartAc(c, { tur: 'Duyuru Yayımı', baslik: `Dış Duyuru Onayı · ${baslik.trim()}`, ozet: govde?.trim() || undefined, hazirlayan: o.kullanici, zincir: [await onayMakami(c, (ust ?? roller[0]!).kimlik)], nesneTuru: 'duyuru', nesneKimligi: id });
        await c.query(`UPDATE duyuru SET is_karti_ref = $2 WHERE kimlik = $1`, [id, kart]);
      }
      { const sahip = kapsam === 'LGM' ? 'İnsan Kaynakları Müdürü' : 'Müşteri ve Paydaş İlişkileri Müdürü'; const sr = (await c.query(`SELECT kimlik FROM rol WHERE rol_adi = $1`, [sahip])).rows[0]?.kimlik; // YG-562
        const al = sr ? (await rolSahipleri(c, sr)).filter((x) => x !== o.kullanici) : []; if (al.length) await bildir(c, { olay: `duyuru-sahip:${id}`, kullanicilar: al, baslik: `Duyuru${dogrudan ? ' Yayımlandı' : ' Onaya Gönderildi'}: ${baslik.trim()}`, ozet: `Kapsam: ${kapsam}` }); }
      await izYaz(c, { aktor: o.kullanici, oturum: o.oturum, eylem: dogrudan ? 'Duyuru Yayımlandı' : 'Duyuru Onaya Gönderildi', nesneTuru: 'duyuru', nesneKimligi: id, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
      await c.query('COMMIT');
      return { kimlik: id, durum: dogrudan ? 'Yayında' : 'Onay Bekliyor' };
    } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
  });

  s.get('/duyuru/yetkim', oturumlu, async (i) => {
    const o = i.oturum!;
    if (o.grup !== 'LGM İç Rolü') return { kapsamlar: [], onaysiz: [] };
    const roller = await kullaniciRolleri(b.db, o.kullanici);
    const ust = roller.some((r) => UST_KADEME.has(r.kademe));
    if (roller.some((r) => r.rol_adi === 'CEO')) return { kapsamlar: KAPSAM, onaysiz: KAPSAM };
    if (ust) return { kapsamlar: KAPSAM, onaysiz: ['LGM'] };
    return roller.some((r) => r.kademe === 'Müdür Yardımcısı') ? { kapsamlar: ['Dış', 'Tümü'], onaysiz: [] } : { kapsamlar: [], onaysiz: [] };
  });

  // YG-560: okunma oranı. Hedef kitle zorunlu duyuruda kapsamdaki aktif hesaplardır.
  s.get('/duyuru/yayimlarim', oturumlu, async (i) => {
    const { rows } = await b.db.query(
      `SELECT d.kimlik, d.baslik, d.zorunlu, d.kapsam, d.durum, d.yayim_zamani, (SELECT count(*)::int FROM duyuru_okuma o WHERE o.duyuru_ref = d.kimlik) AS okuyan,
              (SELECT count(*)::int FROM kullanici_hesabi h WHERE h.hesap_durumu = 'Aktif' AND (d.kapsam = 'Tümü' OR (d.kapsam = 'LGM') = (h.kullanici_grubu = 'LGM İç Rolü'))) AS hedef
         FROM duyuru d WHERE d.yayimlayan_ref = $1 ORDER BY d.yayim_zamani DESC LIMIT 50`, [i.oturum!.kullanici]);
    return rows;
  });

  // YG-1663: İç Mesajlar yalnız LGM personeli içindir; silinmez, düzeltilmez.
  const ic = async (i: { oturum?: { grup: string } }, y: { code: (n: number) => { send: (o: object) => unknown } }) => {
    if (i.oturum!.grup !== 'LGM İç Rolü') { y.code(403).send({ hata: 'İç Mesajlar yalnız LGM personeline açıktır.' }); return false; }
    return true;
  };
  s.get('/mesaj/kisiler', oturumlu, async (i, y) => {
    if (!(await ic(i, y))) return;
    const { rows } = await b.db.query(`SELECT kimlik, ad_soyad FROM kullanici_hesabi WHERE kullanici_grubu = 'LGM İç Rolü' AND hesap_durumu = 'Aktif' AND kimlik <> $1 ORDER BY ad_soyad`, [i.oturum!.kullanici]);
    return rows;
  });
  s.get('/mesaj/ic', oturumlu, async (i, y) => {
    if (!(await ic(i, y))) return;
    const k = i.oturum!.kullanici;
    const { rows } = await b.db.query(
      `SELECT m.kimlik, m.zaman, m.metin, m.okunma_zamani, m.gonderen_ref = $1 AS benden, g.ad_soyad AS gonderen, a.ad_soyad AS alici,
              CASE WHEN m.gonderen_ref = $1 THEN m.alici_ref ELSE m.gonderen_ref END AS karsi
         FROM ic_mesaj m JOIN kullanici_hesabi g ON g.kimlik = m.gonderen_ref JOIN kullanici_hesabi a ON a.kimlik = m.alici_ref
        WHERE $1 IN (m.gonderen_ref, m.alici_ref) ORDER BY m.zaman DESC LIMIT 200`, [k]);
    return rows;
  });
  s.post('/mesaj/ic', oturumlu, async (i, y) => {
    if (!(await ic(i, y))) return;
    const o = i.oturum!; const { alici, metin } = (i.body ?? {}) as { alici?: string; metin?: string };
    if (!alici || !metin?.trim()) return y.code(400).send({ hata: 'Alıcı ve mesaj zorunludur.' });
    if (metin.length > 4000) return y.code(400).send({ hata: 'Mesajın 4.000 karakter içinde kalmasını rica ederiz.' });
    if (alici === o.kullanici) return y.code(400).send({ hata: 'Mesaj için başka bir alıcı seçmenizi rica ederiz.' });
    const v = await b.db.query(`SELECT 1 FROM kullanici_hesabi WHERE kimlik = $1 AND kullanici_grubu = 'LGM İç Rolü' AND hesap_durumu = 'Aktif'`, [alici]);
    if (!v.rowCount) return y.code(400).send({ hata: 'Alıcı geçersizdir.' });
    const { rows } = await b.db.query(`INSERT INTO ic_mesaj (gonderen_ref, alici_ref, metin) VALUES ($1,$2,$3) RETURNING kimlik`, [o.kullanici, alici, metin.trim()]);
    return { kimlik: rows[0].kimlik };
  });
  s.post('/mesaj/ic/okundu', oturumlu, async (i, y) => {
    if (!(await ic(i, y))) return;
    const { karsi } = (i.body ?? {}) as { karsi?: string };
    await b.db.query(`UPDATE ic_mesaj SET okunma_zamani = now() WHERE alici_ref = $1 AND gonderen_ref = $2 AND okunma_zamani IS NULL`, [i.oturum!.kullanici, karsi]);
    return { tamam: true };
  });

  // YG-519: dış kullanıcı kanalını kendisi seçer; iş bildirimleri kapatılamaz (YG-520).
  s.post('/profil/kanal', oturumlu, async (i, y) => {
    const o = i.oturum!; const { kanal } = (i.body ?? {}) as { kanal?: string };
    if (o.grup === 'LGM İç Rolü') return y.code(403).send({ hata: 'Kanal tercihi dış kullanıcılar içindir.' });
    if (!kanal || !['E-posta', 'SMS', 'WhatsApp'].includes(kanal)) return y.code(400).send({ hata: 'Geçersiz kanal.' });
    await b.db.query(`UPDATE kullanici_hesabi SET bildirim_kanali = $2, guncelleme_zamani = now() WHERE kimlik = $1`, [o.kullanici, kanal]);
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Bildirim Kanalı Değişti', yeni: { kanal }, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { tamam: true };
  });
}

/** YG-1413: acil platform değişikliğinin sonradan onayı. */
kapanisKaydet('Acil Platform Değişikliği', async (c, k, karar) => {
  if (karar !== 'Onayla' && karar !== 'Reddet') return;
  await c.query(`UPDATE yazilim_surumu SET sonradan_onay = $2 WHERE kimlik = $1`, [k.nesne_kimligi, karar === 'Onayla' ? 'Onaylandı' : 'Reddedildi']);
});
