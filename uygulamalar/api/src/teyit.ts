import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import { bildir } from './bildirim.js';
import { izYaz } from './denetim.js';
import { dosyaErisimi } from './dosya.js';
import { rolId } from './ihbar.js';
import { kartAc } from './is_motoru.js';
import { tamOturumGerekli, type Baglam } from './kimlik.js';
import { rolSahipleri } from './makam.js';
import { UUID } from './yat.js';
import { sayac } from './sure.js';

type Db = Pool | PoolClient;
const LGM_ALANI = 'limitglobalmarine.com.tr';
/** Herkese açık posta hizmetleri benzerlik karşılaştırmasına girmez; aynı hizmeti kullanan iki kişi şüpheli sayılmaz. */
const GENEL = new Set(['gmail.com', 'hotmail.com', 'outlook.com', 'yahoo.com', 'icloud.com', 'yandex.com', 'live.com', 'msn.com', 'mail.ru', 'gmx.de', 'proton.me']);
const TURLER = ['Banka', 'Fiyat', 'Kapsam', 'Teslim'];
const KANALLAR = ['E-posta', 'WhatsApp', 'Telefon', 'Diğer'];

const alanAdi = (e: string) => e.trim().toLowerCase().split('@')[1] ?? '';
/** Göze benzeyen harfler aynı sayılır (rn→m, vv→w, 0→o, 1→l, ı→i). */
const sade = (a: string) => a.replace(/rn/g, 'm').replace(/vv/g, 'w').replace(/0/g, 'o').replace(/[1|]/g, 'l').replace(/ı/g, 'i');
const kok = (a: string) => a.replace(/\.(com|net|org)(\.tr)?$|\.(tr|eu|de|uk|co\.uk)$/, '');
function mesafe(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)] as number[]);
  for (let j = 1; j <= b.length; j++) d[0]![j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length]![b.length]!;
}

/** YG-1272: gönderen alan adı tanımlı bir alan adına benziyor ama aynı değilse benzediği alan adını döner. */
export function benzerAlanAdi(gonderen: string, tanimlilar: string[]): string | null {
  const g = alanAdi(gonderen); if (!g || GENEL.has(g)) return null;
  for (const t of new Set(tanimlilar.map((x) => x.toLowerCase()).filter((x) => x && !GENEL.has(x)))) {
    if (t === g) return null;
  }
  for (const t of new Set(tanimlilar.map((x) => x.toLowerCase()).filter((x) => x && !GENEL.has(x)))) {
    const [a, b] = [sade(g), sade(t)];
    if (a === b || kok(a) === kok(b) || (Math.min(a.length, b.length) >= 6 && mesafe(kok(a), kok(b)) <= 2)) return t;
  }
  return null;
}

/** Dosyaya ve kuruma tanımlı e-posta alan adları: LGM, dosya tarafları, sigorta Ek-2 ve Ek-3 adresleri, kurumsal müşteri kullanıcıları. */
async function tanimliAlanlar(db: Db, dosya?: string | null): Promise<string[]> {
  const r = (await db.query(`SELECT eposta FROM sigorta_ek2_adres UNION SELECT onay_yetkilisi_eposta FROM dosya_sigorta_kaydi WHERE onay_yetkilisi_eposta IS NOT NULL
    UNION SELECT h.e_posta FROM kurumsal_kullanici k JOIN kullanici_hesabi h ON h.kimlik = k.kullanici_ref WHERE h.e_posta IS NOT NULL
    UNION SELECT eposta FROM dosya_tarafi WHERE eposta IS NOT NULL AND ($1::uuid IS NULL OR dosya_ref = $1)`, [dosya ?? null])).rows;
  return [LGM_ALANI, ...r.map((x) => alanAdi(String(Object.values(x)[0])))];
}

/** Benzer alan adı bulunursa Bilgi Güvenliği Göstergesi açılır, Bilgi İşlem ve Hukuk ve Uyum bilgilenir; uyarı metni döner. */
export async function benzerAlanKontrolu(db: Db, gonderen: string | undefined, kullanici: string, dosya?: string | null): Promise<string | null> {
  if (!gonderen?.includes('@')) return null;
  const t = benzerAlanAdi(gonderen, await tanimliAlanlar(db, dosya));
  if (!t) return null;
  const ozet = `Benzer alan adlı gönderen: ${gonderen.trim()} (tanımlı: ${t})`;
  const o = (await db.query(`INSERT INTO olay_kaydi (olay_turu, ozet, dosya_ref, acan_ref, olay_no) VALUES ('Bilgi Güvenliği Göstergesi', $1, $2, $3, $4) RETURNING kimlik`, [ozet, dosya ?? null, kullanici, `LGM-OL-${String(await sayac(db, 'olay-kaydi')).padStart(5, '0')}`])).rows[0];
  const al: string[] = []; for (const r of ['Bilgi İşlem Müdürü', 'Sistem Yöneticisi', 'Hukuk ve Uyum Direktörü']) al.push(...await rolSahipleri(db, await rolId(db, r)));
  await bildir(db, { olay: `benzer-alan:${o.kimlik}`, kullanicilar: [...new Set(al)], baslik: 'Bilgi Güvenliği Göstergesi', ozet, oncelik: 'Yüksek' });
  return `Gönderen adresi tanımlı ${t} alan adına benziyor ancak aynı değildir; ileti kabul edilmedi ve güvenlik kaydı açıldı.`;
}

export function teyitYollari(s: FastifyInstance, b: Baglam) {
  const oturumlu = { preHandler: tamOturumGerekli(b) };
  const yok = (y: FastifyReply) => y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' });

  // YG-1272: dışarıdan gelen değişiklik talebi kaydedilir; teyit edilene kadar uygulanamaz, Dosya Sorumlusuna görev açılır.
  s.post('/dosya/:id/dis-talep', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { tur?: string; kanal?: string; gonderen?: string; ozet?: string; belge?: string };
    if (o.grup !== 'LGM İç Rolü' || !UUID.test(id) || !(await dosyaErisimi(b.db, o.kullanici, id))) return yok(y);
    if (!TURLER.includes(g.tur ?? '') || !KANALLAR.includes(g.kanal ?? '') || !g.gonderen?.trim() || !g.ozet?.trim()) return y.code(400).send({ hata: 'Talep türü, geldiği kanal, gönderen ve özet zorunludur.' });
    if (g.belge && !UUID.test(g.belge)) return y.code(400).send({ hata: 'Belge geçersizdir.' });
    const uyari = await benzerAlanKontrolu(b.db, g.gonderen, o.kullanici, id);
    const d = (await b.db.query(`SELECT dosya_no, dosya_sorumlusu_ref FROM dosya WHERE kimlik = $1`, [id])).rows[0];
    const t = (await b.db.query(`INSERT INTO dis_degisiklik_talebi (dosya_ref, tur, gelis_kanali, gonderen, ozet, belge_ref, guvenlik_uyarisi, kaydeden_ref) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING kimlik`, [id, g.tur, g.kanal, g.gonderen.trim(), g.ozet.trim(), g.belge ?? null, uyari, o.kullanici])).rows[0];
    if (d.dosya_sorumlusu_ref) await kartAc(b.db, { tur: 'İkinci Kanal Teyidi', kategori: 'gorev', baslik: `${d.dosya_no} · ${g.tur} Değişikliği Teyidi`, ozet: `Talebi dosyadaki kayıtlı numaradan arayarak teyit ediniz; iletideki numara veya adres kullanılmaz.${uyari ? ' Güvenlik uyarısı var.' : ''}`, oncelik: 'Yüksek', sahipKullanici: d.dosya_sorumlusu_ref, nesneTuru: 'Dış Değişiklik Talebi', nesneKimligi: t.kimlik });
    return { kimlik: t.kimlik, durum: 'Teyit Bekliyor', uyari };
  });

  // Teyit yalnız dosyada önceden kayıtlı bir numarayla verilir; talebi kaydeden kişi teyit veremez.
  s.post('/dis-talep/:id/teyit', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { telefon?: string; sonuc?: string; not?: string };
    if (o.grup !== 'LGM İç Rolü' || !UUID.test(id)) return yok(y);
    const t = (await b.db.query(`SELECT * FROM dis_degisiklik_talebi WHERE kimlik = $1 AND durum = 'Teyit Bekliyor'`, [id])).rows[0];
    if (!t || !(await dosyaErisimi(b.db, o.kullanici, t.dosya_ref))) return yok(y);
    if (t.kaydeden_ref === o.kullanici) return y.code(409).send({ hata: 'Talebi kaydeden kişi teyit veremez.' });
    if (!['Teyit Edildi', 'Teyit Edilmedi'].includes(g.sonuc ?? '') || !g.telefon?.trim() || !g.not?.trim()) return y.code(400).send({ hata: 'Aranan numara, sonuç ve görüşme notu zorunludur.' });
    const tel = g.telefon.replace(/\D/g, '');
    const kayitli = (await b.db.query(`SELECT telefon FROM dosya_tarafi WHERE dosya_ref = $1 AND telefon IS NOT NULL AND aktif`, [t.dosya_ref])).rows.map((r) => String(r.telefon).replace(/\D/g, ''));
    if (!kayitli.some((k) => k.length >= 10 && (k.endsWith(tel.slice(-10)) && tel.length >= 10))) return y.code(409).send({ hata: 'Teyit, dosyada önceden kayıtlı bir numaradan alınır.' });
    await b.db.query(`UPDATE dis_degisiklik_talebi SET durum = $2, teyit_numarasi = $3, teyit_notu = $4, teyit_eden_ref = $5, teyit_zamani = now() WHERE kimlik = $1`, [id, g.sonuc, g.telefon.trim(), g.not.trim(), o.kullanici]);
    await b.db.query(`UPDATE is_karti SET durum = 'Tamamlandı', kapanma_zamani = now() WHERE tur = 'İkinci Kanal Teyidi' AND nesne_kimligi = $1 AND kapanma_zamani IS NULL`, [id]);
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'İkinci Kanal Teyidi', nesneTuru: 'Dış Değişiklik Talebi', nesneKimligi: id, yeni: { sonuc: g.sonuc }, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { durum: g.sonuc };
  });

  s.get('/dosya/:id/dis-talepler', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string };
    if (o.grup !== 'LGM İç Rolü' || !UUID.test(id) || !(await dosyaErisimi(b.db, o.kullanici, id))) return yok(y);
    return (await b.db.query(`SELECT kimlik, tur, gelis_kanali, gonderen, ozet, durum, guvenlik_uyarisi, teyit_zamani, olusturma_zamani FROM dis_degisiklik_talebi WHERE dosya_ref = $1 ORDER BY olusturma_zamani DESC`, [id])).rows;
  });
}
