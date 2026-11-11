import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Pool } from 'pg';
import { tamOturumGerekli, type Baglam } from './kimlik.js';

const BT = ['Bilgi İşlem Müdürü', 'Bilgi İşlem Müdür Yardımcısı', 'Sistem Yöneticisi', 'Bilgi Teknolojileri ve Firma Yönetimi Direktörü', 'CEO', 'Genel Müdür Yardımcısı'];
/** YG-778: kritik iş akışları; istek yolu önekine göre. */
export const AKISLAR: [RegExp, string][] = [[/^\/api\/kimlik\//, 'Giriş ve Kimlik'], [/^\/api\/ihbar/, 'İhbar ve Talep'], [/^\/api\/dosya/, 'Dosya'], [/^\/api\/(teklif|fiyat-teklifi)/, 'Teklif'], [/^\/api\/is\//, 'Onay ve Görev'], [/^\/api\/(fatura|tahsilat|hakedis|odeme)/, 'Fatura ve Ödeme'], [/^\/api\/(belge|dosya-belge)/, 'Belge'], [/^\/api\/(portal|sigorta|kurumsal|firma-portal)/, 'Dış Portallar']];
type Kova = { adet: number; hata: number; toplam: number; azami: number };
const BELLEK = new Map<string, Kova>();
const dakika = (d = new Date()) => { const x = new Date(d); x.setUTCSeconds(0, 0); return x.toISOString(); };

/** Her yanıt süresi ve sonucu dakika ve akış bazında bellekte toplanır; istek gövdesi tutulmaz. */
export function olcumKur(s: FastifyInstance) {
  s.addHook('onResponse', async (i, y) => {
    const akis = AKISLAR.find(([r]) => r.test(i.url))?.[1] ?? 'Diğer'; const k = `${dakika()}|${akis}`;
    const v = BELLEK.get(k) ?? { adet: 0, hata: 0, toplam: 0, azami: 0 }; const ms = Math.round(y.elapsedTime);
    v.adet++; if (y.statusCode >= 500) v.hata++; v.toplam += ms; v.azami = Math.max(v.azami, ms); BELLEK.set(k, v);
  });
}

/** Bellekteki ölçümleri yazar ve çalışma nabzını işaretler (her dakika). */
export async function olcumYaz(db: Pool, simdi = new Date()): Promise<number> {
  const l = [...BELLEK]; BELLEK.clear();
  for (const [k, v] of l) { const [dk, akis] = k.split('|'); await db.query(`INSERT INTO istek_olcumu (dakika, akis, adet, hata, toplam_ms, azami_ms) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (dakika, akis) DO UPDATE SET adet = istek_olcumu.adet + EXCLUDED.adet, hata = istek_olcumu.hata + EXCLUDED.hata, toplam_ms = istek_olcumu.toplam_ms + EXCLUDED.toplam_ms, azami_ms = greatest(istek_olcumu.azami_ms, EXCLUDED.azami_ms)`, [dk, akis, v.adet, v.hata, v.toplam, v.azami]); }
  await db.query(`INSERT INTO calisma_nabzi (dakika) VALUES ($1) ON CONFLICT DO NOTHING`, [dakika(simdi)]);
  await db.query(`DELETE FROM istek_olcumu WHERE dakika < now() - interval '90 days'`); await db.query(`DELETE FROM calisma_nabzi WHERE dakika < now() - interval '90 days'`);
  return l.length;
}

/** Kullanılabilirlik: pencere içinde nabız kaydı olan dakikaların, ilk kayıttan bu yana geçen dakikalara oranı. */
async function kullanilabilirlik(db: Pool, saat: number) {
  const r = (await db.query(`SELECT count(*)::int n, min(dakika) ilk FROM calisma_nabzi WHERE dakika > now() - make_interval(hours => $1)`, [saat])).rows[0];
  if (!r.ilk) return { oran: null, kesintiDakika: null };
  const toplam = Math.max(1, Math.round((Date.now() - +new Date(r.ilk)) / 60_000) + 1);
  return { oran: Math.min(100, Math.round((1000 * r.n) / toplam) / 10), kesintiDakika: Math.max(0, toplam - r.n) };
}

export async function sistemIzleme(db: Pool) {
  await olcumYaz(db);
  const akislar = (await db.query(`SELECT akis, sum(adet)::int adet, sum(hata)::int hata, round(sum(toplam_ms)::numeric / nullif(sum(adet), 0))::int ortalama_ms, max(azami_ms) azami_ms FROM istek_olcumu WHERE dakika > now() - interval '24 hours' GROUP BY akis ORDER BY sum(adet) DESC`)).rows
    .map((x) => ({ ...x, hataOrani: x.adet ? Math.round((1000 * x.hata) / x.adet) / 10 : 0 }));
  const kapasite = (await db.query(`SELECT pg_database_size(current_database())::bigint vt_bayt, (SELECT count(*)::int FROM pg_stat_activity WHERE datname = current_database()) baglanti, current_setting('max_connections')::int azami_baglanti, (SELECT count(*)::int FROM belge) belge, (SELECT count(*)::int FROM dosya WHERE statu IN ('Açılış Kontrolünde', 'Aktif', 'Kontrollü Askıda')) acik_dosya`)).rows[0];
  const kuyruk = (await db.query(`SELECT (SELECT count(*)::int FROM gonderim WHERE durum = 'Bekliyor') gonderim, (SELECT round(extract(epoch FROM now() - min(olusturma_zamani)) / 60)::int FROM gonderim WHERE durum = 'Bekliyor') gonderim_en_eski_dk,
      (SELECT count(*)::int FROM gonderim WHERE durum = 'Bekliyor' AND deneme > 2) gonderim_tekrar, (SELECT count(*)::int FROM belge_uretim WHERE durum = 'Bekliyor') belge_uretim, (SELECT count(*)::int FROM is_karti WHERE durum = 'Bekliyor' AND son_zaman < now()) geciken_is`)).rows[0];
  const terk = (await db.query(`SELECT (SELECT count(*)::int FROM davet WHERE kullanilma_zamani IS NULL AND son_gecerlilik < now()) suresi_dolan_davet, (SELECT count(*)::int FROM talep WHERE statu = 'Yeni Talep' AND olusturma_zamani < now() - interval '24 hours') bekleyen_talep,
      (SELECT count(*)::int FROM fiyat_teklifi WHERE statu = 'Taslak' AND olusturma_zamani < now() - interval '7 days') eski_taslak_teklif, (SELECT count(*)::int FROM kullanici_hesabi h WHERE h.hesap_durumu = 'Aktif' AND h.kullanici_grubu <> 'LGM İç Rolü' AND NOT EXISTS (SELECT 1 FROM kullanim_kosullari_kabulu k WHERE k.kullanici_ref = h.kimlik)) ilk_girisi_bitmeyen`)).rows[0];
  return { uretim: new Date().toISOString(), kullanilabilirlik: { son24Saat: await kullanilabilirlik(db, 24), son7Gun: await kullanilabilirlik(db, 168) }, akislar, kapasite: { ...kapasite, vt_mb: Math.round(Number(kapasite.vt_bayt) / 1_048_576) }, kuyruk, terk };
}

export function sistemIzlemeYollari(s: FastifyInstance, b: Baglam) {
  const oturumlu = { preHandler: tamOturumGerekli(b) };
  const yok = (y: FastifyReply) => y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' });
  s.get('/sistem-izleme', oturumlu, async (i, y) => {
    if (!(await b.db.query(`SELECT 1 FROM rol_atamasi a JOIN rol x ON x.kimlik = a.rol_ref WHERE a.kullanici_ref = $1 AND a.atama_durumu = 'Aktif' AND x.rol_adi = ANY($2::text[]) LIMIT 1`, [i.oturum!.kullanici, BT])).rowCount) return yok(y);
    return sistemIzleme(b.db);
  });
}
