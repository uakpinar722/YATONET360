import type { FastifyInstance, FastifyReply } from 'fastify';
import pg, { type Pool } from 'pg';
import { randomBytes } from 'node:crypto';
import { denemeHesaplari, kurVeritabani } from '../araclar/kurulum.js';
import { nobetCagriIsle } from './acil_ek.js';
import { COOKIE_ADI, ortamOku } from './ayarlar.js';
import { bildir, birKez } from './bildirim.js';
import { izYaz } from './denetim.js';
import { rolId } from './ihbar.js';
import { kartAc } from './is_motoru.js';
import { tamOturumGerekli, type Baglam } from './kimlik.js';
import { suankiAdim, totpKodu } from './kripto.js';
import { rolSahipleri } from './makam.js';
import { parolaOzetle } from './parola.js';
import { puantajGorevi } from './personel_karne.js';
import { DenemeKutusu } from './sms.js';
import { sayac } from './sure.js';
import { isGunuSonu } from './teklif.js';
import { UUID } from './yat.js';

/**
 * YG-1652: Sistem Öz Denetimi. Her çalışma ayrı ve sentetik bir veritabanı kurar, beş farklı süreçten beş senaryo dener
 * (olağan akış ve kural ihlali denemesi). Beklenen sonuç kural kataloğundaki gereksinimden gelir; yapay zekâ kullanılmaz.
 * Havuz bitmeden aynı senaryo tekrarlanmaz; bulgu çıkan süreç sonraki iki çalışmada yeniden denenir.
 */
const ROLLER = ['Bilgi İşlem Müdürü', 'Bilgi İşlem Müdür Yardımcısı', 'Sistem Yöneticisi', 'Bilgi Teknolojileri ve Firma Yönetimi Direktörü'];
const BTD = 'Bilgi Teknolojileri ve Firma Yönetimi Direktörü'; const BIM = 'Bilgi İşlem Müdürü';
const KADRO: Record<string, string> = {
  ds: 'Dosya Sorumlusu', oy: 'Operasyon Yöneticisi', opm: 'Operasyon Müdürü', ts: 'Tedarik Sorumlusu', tyo: 'Tedarik Yöneticisi',
  bim: BIM, sy: 'Sistem Yöneticisi', iks: 'İnsan Kaynakları Sorumlusu', hud: 'Hukuk ve Uyum Direktörü', tid: 'Ticari İşler Direktörü',
};
const SUREC_SAHIBI: Record<string, string> = {
  Operasyon: 'Operasyon Müdürü', 'Bilgi İşlem': BIM, 'Onay Zinciri': 'Genel Müdür Yardımcısı', 'İnsan Kaynakları': 'İnsan Kaynakları Müdürü',
  'Hukuk ve Uyum': 'Hukuk ve Uyum Direktörü', 'Olay Yönetimi': 'Genel Müdür Yardımcısı', Ticari: 'Ticari İşler Direktörü', Tedarik: 'Tedarik Yönetimi Müdürü',
};
const SURE_DK = 60; // Sürmekte görünen çalışma bu süreden sonra yarım kalmış sayılır.

type Ortam = { db: Pool; sup: pg.Client; s: FastifyInstance; K: Record<string, string>; ist: (m: 'GET' | 'POST', url: string, c?: string, payload?: object) => Promise<{ statusCode: number; json: () => any; body: string }>; gir: (k: string) => Promise<string> };
type Sonuc = { basarili: boolean; gerceklesen: string };
export type Senaryo = { kod: string; surec: string; ad: string; tur: 'Olağan Akış' | 'Kural İhlali Denemesi'; bulgu: 'Yetki' | 'Gizlilik' | 'Süre' | 'Akış'; beklenen: string; calistir: (o: Ortam) => Promise<Sonuc> };

const durum = (r: { statusCode: number }, beklenen: number[]) => ({ basarili: beklenen.includes(r.statusCode), gerceklesen: `HTTP ${r.statusCode}` });
const DGS = { konu: 'Öz denetim', gerekce: 'Sentetik deneme', mevcut: 'Sentetik', beklenen: 'Sentetik', talepSahibi: 'Öz Denetim', etkilenen: 'Yok', kabulOlcutu: 'Sentetik' };

export const SENARYOLAR: Senaryo[] = [
  { kod: 'OD-OPS-01', surec: 'Operasyon', ad: 'Tedarik Sorumlusu operasyon panosunu açmayı dener', tur: 'Kural İhlali Denemesi', bulgu: 'Yetki', beklenen: 'Erişim reddedilir (YG-1582: pano yalnız Operasyon Yöneticisi, Müdür Yardımcısı ve Müdürüne açıktır)',
    calistir: async (o) => durum(await o.ist('GET', '/api/operasyon-pano', await o.gir('ts')), [403, 404]) },
  { kod: 'OD-OPS-02', surec: 'Operasyon', ad: '15 dakikada dönülmeyen nöbet çağrısı', tur: 'Kural İhlali Denemesi', bulgu: 'Süre', beklenen: 'Çağrı Operasyon Yöneticisine yükselir (YG-243)',
    calistir: async (o) => {
      const r = await o.ist('POST', '/api/nobet/cagri', await o.gir('ds'), { hat: 'Operasyon', arayan: 'Öz Denetim', ozet: 'Sentetik çağrı' }); if (r.statusCode !== 200) return { basarili: false, gerceklesen: `Çağrı açılamadı (HTTP ${r.statusCode})` };
      await nobetCagriIsle(o.db, new Date(Date.now() + 16 * 60_000));
      const rol = (await o.sup.query(`SELECT sorumlu_rol FROM nobet_cagrisi WHERE kimlik = $1`, [r.json().kimlik])).rows[0]?.sorumlu_rol as string;
      return { basarili: rol === 'Operasyon Yöneticisi', gerceklesen: `Sorumlu katman: ${rol}` };
    } },
  { kod: 'OD-BT-01', surec: 'Bilgi İşlem', ad: 'Sistem Yöneticisi değişiklik bileti açar', tur: 'Olağan Akış', bulgu: 'Akış', beklenen: 'Bilet DGS numarası alır ve Bilgi İşlem Müdürü onayına düşer (YG-1001)',
    calistir: async (o) => {
      const r = await o.ist('POST', '/api/degisiklik-bileti', await o.gir('sy'), DGS); if (r.statusCode !== 200) return { basarili: false, gerceklesen: `HTTP ${r.statusCode}` };
      const k = (await o.sup.query(`SELECT x.rol_adi FROM is_karti k JOIN rol x ON x.kimlik = k.zincir[k.kademe + 1] WHERE k.tur = 'Değişiklik Bileti' AND k.nesne_kimligi = $1`, [r.json().kimlik])).rows[0]?.rol_adi as string;
      return { basarili: /^DGS-\d{4}-\d{4}$/.test(r.json().biletNo) && k === BIM, gerceklesen: `${r.json().biletNo} · Onay makamı: ${k ?? 'yok'}` };
    } },
  { kod: 'OD-BT-02', surec: 'Bilgi İşlem', ad: 'Dosya Sorumlusu değişiklik bileti açmayı dener', tur: 'Kural İhlali Denemesi', bulgu: 'Yetki', beklenen: 'İşlem reddedilir (YG-1001: bileti Sistem Yöneticisi açar)',
    calistir: async (o) => durum(await o.ist('POST', '/api/degisiklik-bileti', await o.gir('ds'), DGS), [403, 404]) },
  { kod: 'OD-ONY-01', surec: 'Onay Zinciri', ad: 'Yanlış kademeden onay denemesi', tur: 'Kural İhlali Denemesi', bulgu: 'Yetki', beklenen: 'Zincirde olmayan kullanıcının kararı reddedilir; kart Bekliyor kalır (YG-1637)',
    calistir: async (o) => {
      const r = await o.ist('POST', '/api/degisiklik-bileti', await o.gir('sy'), DGS); if (r.statusCode !== 200) return { basarili: false, gerceklesen: `Bilet açılamadı (HTTP ${r.statusCode})` };
      const k = (await o.sup.query(`SELECT kimlik FROM is_karti WHERE tur = 'Değişiklik Bileti' AND nesne_kimligi = $1`, [r.json().kimlik])).rows[0].kimlik as string;
      const c = await o.ist('POST', `/api/is/${k}/karar`, await o.gir('ds'), { karar: 'Onayla' });
      const d = (await o.sup.query(`SELECT durum FROM is_karti WHERE kimlik = $1`, [k])).rows[0].durum as string;
      return { basarili: c.statusCode !== 200 && d === 'Bekliyor', gerceklesen: `HTTP ${c.statusCode} · Kart: ${d}` };
    } },
  { kod: 'OD-ONY-02', surec: 'Onay Zinciri', ad: 'Kendi hazırladığı kaydı onaylama denemesi', tur: 'Kural İhlali Denemesi', bulgu: 'Yetki', beklenen: 'Hazırlayan kendi kaydını onaylayamaz',
    calistir: async (o) => {
      const b = await o.gir('bim'); const r = await o.ist('POST', '/api/degisiklik-bileti', b, DGS); if (r.statusCode !== 200) return { basarili: false, gerceklesen: `Bilet açılamadı (HTTP ${r.statusCode})` };
      const k = (await o.sup.query(`SELECT kimlik FROM is_karti WHERE tur = 'Değişiklik Bileti' AND nesne_kimligi = $1`, [r.json().kimlik])).rows[0].kimlik as string;
      return durum(await o.ist('POST', `/api/is/${k}/karar`, b, { karar: 'Onayla' }), [403, 404, 409]);
    } },
  { kod: 'OD-IK-01', surec: 'İnsan Kaynakları', ad: 'Aylık puantaj görevi', tur: 'Olağan Akış', bulgu: 'Süre', beklenen: 'Görev ayda bir açılır; son zaman izleyen ayın 3. iş günü 12:00 (YG-1615)',
    calistir: async (o) => {
      const s = new Date(); const ilk = await puantajGorevi(o.db, s); const ikinci = await puantajGorevi(o.db, s);
      const k = (await o.sup.query(`SELECT son_zaman FROM is_karti WHERE tur = 'Aylık Puantaj' ORDER BY olusturma_zamani DESC LIMIT 1`)).rows[0];
      const ay = new Date(`${new Date(s.getTime() + 3 * 3_600_000).toISOString().slice(0, 7)}-01T00:00:00Z`); const son = await isGunuSonu(o.db, ay, 3); son.setUTCHours(9, 0, 0, 0);
      return { basarili: ilk && !ikinci && k && new Date(k.son_zaman).getTime() === son.getTime(), gerceklesen: `İlk: ${ilk} · Tekrar: ${ikinci} · Son: ${k ? new Date(k.son_zaman).toISOString() : 'yok'}` };
    } },
  { kod: 'OD-IK-02', surec: 'İnsan Kaynakları', ad: 'Dosya Sorumlusu izin kontrol listesini açmayı dener', tur: 'Kural İhlali Denemesi', bulgu: 'Gizlilik', beklenen: 'Erişim reddedilir (izin kontrolünü İnsan Kaynakları yapar)',
    calistir: async (o) => durum(await o.ist('GET', '/api/ik/izin-kontrol', await o.gir('ds')), [403, 404]) },
  { kod: 'OD-HUK-01', surec: 'Hukuk ve Uyum', ad: 'Dosya Sorumlusu Resmî Gazete taramasını açmayı dener', tur: 'Kural İhlali Denemesi', bulgu: 'Yetki', beklenen: 'Erişim reddedilir (YG-1695: Hukuk ve Uyum)',
    calistir: async (o) => durum(await o.ist('GET', '/api/resmi-gazete', await o.gir('ds')), [403, 404]) },
  { kod: 'OD-HUK-02', surec: 'Hukuk ve Uyum', ad: 'Hukuk ve Uyum Direktörü Resmî Gazete taramasını açar', tur: 'Olağan Akış', bulgu: 'Akış', beklenen: 'Tarama listesi açılır',
    calistir: async (o) => durum(await o.ist('GET', '/api/resmi-gazete', await o.gir('hud')), [200]) },
  { kod: 'OD-OLY-01', surec: 'Olay Yönetimi', ad: 'BT kesintisi olayının yöneticisi', tur: 'Olağan Akış', bulgu: 'Akış', beklenen: 'Olay yöneticisi Bilgi İşlem Müdürüdür ve kartı görür (YG-261, YG-1584)',
    calistir: async (o) => {
      const r = await o.ist('POST', '/api/olay-komutasi', await o.gir('ds'), { tur: 'BT Kesintisi veya Veri İhlali', ozet: 'Sentetik olay' }); if (r.statusCode !== 200) return { basarili: false, gerceklesen: `HTTP ${r.statusCode}` };
      const l = (await o.ist('GET', '/api/olay/yoneticisi-oldugum', await o.gir('bim'))).json() as { kimlik: string }[];
      return { basarili: l.some((x) => x.kimlik === r.json().kimlik), gerceklesen: `Bilgi İşlem Müdürü kartında: ${l.some((x) => x.kimlik === r.json().kimlik) ? 'var' : 'yok'}` };
    } },
  { kod: 'OD-OLY-02', surec: 'Olay Yönetimi', ad: 'Olay yöneticisi olmayan kullanıcı olay kartını görmeye çalışır', tur: 'Kural İhlali Denemesi', bulgu: 'Gizlilik', beklenen: 'Kart görünmez',
    calistir: async (o) => { const l = (await o.ist('GET', '/api/olay/yoneticisi-oldugum', await o.gir('ts'))).json() as unknown[]; return { basarili: Array.isArray(l) && l.length === 0, gerceklesen: `${Array.isArray(l) ? l.length : '?'} kart` }; } },
  { kod: 'OD-TIC-01', surec: 'Ticari', ad: 'Tedarik Sorumlusu kartela taslak sürümü açmayı dener', tur: 'Kural İhlali Denemesi', bulgu: 'Yetki', beklenen: 'İşlem reddedilir (kartela maliyeti yalnız Ticari İşler Direktörü ve CEO)',
    calistir: async (o) => durum(await o.ist('POST', '/api/kartela/taslak', await o.gir('ts'), {}), [403, 404]) },
  { kod: 'OD-TIC-02', surec: 'Ticari', ad: 'Yürürlükteki kartela sürümünden kalem kaldırma denemesi', tur: 'Kural İhlali Denemesi', bulgu: 'Akış', beklenen: 'Reddedilir; kalem yalnız taslak sürümde kaldırılır (YG-661)',
    calistir: async (o) => durum(await o.ist('POST', '/api/kartela/taslak/kaldir', await o.gir('tid'), { kod: 'X', gerekce: 'Öz denetim' }), [409]) },
  { kod: 'OD-TED-01', surec: 'Tedarik', ad: 'Dosya Sorumlusu tedarik panosunu açmayı dener', tur: 'Kural İhlali Denemesi', bulgu: 'Yetki', beklenen: 'Erişim reddedilir (YG-1592)',
    calistir: async (o) => durum(await o.ist('GET', '/api/tedarik-pano', await o.gir('ds')), [403, 404]) },
  { kod: 'OD-TED-02', surec: 'Tedarik', ad: 'Tedarik Yöneticisi tedarik panosunu açar', tur: 'Olağan Akış', bulgu: 'Akış', beklenen: 'Pano açılır ve dağıtım yetkisi görünür (YG-1592)',
    calistir: async (o) => { const r = await o.ist('GET', '/api/tedarik-pano', await o.gir('tyo')); return { basarili: r.statusCode === 200 && r.json().dagitir === true, gerceklesen: `HTTP ${r.statusCode}` }; } },
];

/** Havuzdan beş farklı süreçten senaryo seçer; bulgu çıkan süreç önce gelir, döngüde denenen senaryo tekrarlanmaz. */
export function senaryoSec(havuz: Senaryo[], kullanilan: Set<string>, oncelikli: string[], adet = 5): { secim: Senaryo[]; yeniDongu: boolean } {
  const surecler = [...new Set(havuz.map((x) => x.surec))].sort((a, c) => Number(oncelikli.includes(c)) - Number(oncelikli.includes(a)));
  const sec = (k: Set<string>) => { const l: Senaryo[] = []; for (const s of surecler) { if (l.length >= adet) break; const x = havuz.find((h) => h.surec === s && !k.has(h.kod)) ?? (oncelikli.includes(s) ? havuz.find((h) => h.surec === s) : undefined); if (x) l.push(x); } return l; };
  const l = sec(kullanilan);
  if (l.length >= Math.min(adet, surecler.length)) return { secim: l, yeniDongu: false };
  return { secim: sec(new Set()), yeniDongu: true };
}

/** YG-1652: sıklık canlı kullanım başlangıcından itibaren: 0–3 ay her gece, 3–6 ay haftada 3 gece (Pzt, Çrş, Cuma), 6–12 ay haftada 1 (Pazartesi), sonra 15 günde bir. */
export function ozDenetimGunuMu(baslangic: number, simdi: Date): boolean {
  if (!baslangic) return false;
  const b = Date.UTC(Math.floor(baslangic / 10000), Math.floor(baslangic / 100) % 100 - 1, baslangic % 100); const t = new Date(simdi.getTime() + 3 * 3_600_000);
  const gun = Math.floor((Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate()) - b) / 86_400_000); if (gun < 0) return false;
  const bd = new Date(b); const ay = (t.getUTCFullYear() - bd.getUTCFullYear()) * 12 + t.getUTCMonth() - bd.getUTCMonth() - (t.getUTCDate() < bd.getUTCDate() ? 1 : 0);
  if (ay < 3) return true;
  if (ay < 6) return [1, 3, 5].includes(t.getUTCDay());
  if (ay < 12) return t.getUTCDay() === 1;
  return gun % 15 === 0;
}

/** Ayrı veritabanında sentetik kadro ve uygulama örneği; dış bildirim deneme kutusuna gider. */
async function ortamKur(vt: string): Promise<Ortam & { kapat: () => Promise<void> }> {
  const e = ortamOku();
  const a = new pg.Client({ host: 'localhost', user: 'postgres', password: e.POSTGRES_SUPER_PAROLA, database: 'postgres' });
  await a.connect(); await a.query(`DROP DATABASE IF EXISTS ${vt} WITH (FORCE)`); await a.end();
  const sup = await kurVeritabani(vt, { superParola: e.POSTGRES_SUPER_PAROLA!, uygulamaParola: e.YATONET_DB_PAROLA!, denemeHesap: false });
  await denemeHesaplari(sup, null);
  const parola = randomBytes(18).toString('base64url') + 'aA1!'; const oz = await parolaOzetle(parola); const K: Record<string, string> = {}; const D = '@ozdenetim.yatonet.local';
  for (const [k, rol] of Object.entries(KADRO)) {
    K[k] = (await sup.query(`INSERT INTO kullanici_hesabi (hesap_turu, kullanici_grubu, ad_soyad, kullanici_adi, e_posta, parola_ozeti, dogrulama_yontemi) VALUES ('İç Kullanıcı','LGM İç Rolü',$1,$2,$2,$3,'Doğrulama uygulaması (6 haneli kod)') RETURNING kimlik`, [`Öz Denetim ${rol}`, k + D, oz])).rows[0].kimlik;
    await sup.query(`INSERT INTO rol_atamasi (kullanici_ref, rol_ref) SELECT $1, kimlik FROM rol WHERE rol_adi = $2`, [K[k], rol]);
  }
  await sup.query(`UPDATE kullanici_hesabi SET izin_adimi_zamani = now() WHERE e_posta LIKE $1`, [`%${D}`]);
  await sup.query(`INSERT INTO aydinlatma_kaydi (ilgili_kisi_ref, ilgili_kisi_grubu, aydinlatma_metni, metin_surumu, dil, sunum_kanali) SELECT kimlik, 'Çalışan', 'KVKK-05', 'R00', 'Türkçe', 'Web' FROM kullanici_hesabi WHERE e_posta LIKE $1`, [`%${D}`]);
  await sup.query(`INSERT INTO kullanim_kosullari_kabulu (kullanici_ref, prt_surumu, dil) SELECT kimlik, 'R00', 'Türkçe' FROM kullanici_hesabi WHERE e_posta LIKE $1`, [`%${D}`]);
  const db = new pg.Pool({ host: 'localhost', user: 'yatonet_uygulama', password: e.YATONET_DB_PAROLA, database: vt });
  const { sunucuKur } = await import('./sunucu.js');
  const s = await sunucuKur({ db, sms: new DenemeKutusu(null), eposta: new DenemeKutusu(null), anahtar: randomBytes(32).toString('hex'), guvenliCerez: false, webAdresi: 'http://ozdenetim' });
  const H = { 'x-yatonet': '1' }; const oturum: Record<string, string> = {};
  const ckr = (r: { cookies: { name: string; value: string }[] }) => r.cookies.find((c) => c.name === COOKIE_ADI)?.value as string;
  const ist: Ortam['ist'] = async (m, url, c, payload) => s.inject({ method: m, url, headers: H, cookies: c ? { [COOKIE_ADI]: c } : {}, payload }) as never;
  const gir = async (k: string) => {
    if (oturum[k]) return oturum[k]!;
    const c = ckr(await s.inject({ method: 'POST', url: '/api/kimlik/giris', headers: H, payload: { kimlik: k + D, parola } }) as never);
    const q = await ist('GET', '/api/kimlik/kurulum', c);
    return (oturum[k] = ckr(await ist('POST', '/api/kimlik/dogrula', c, { kod: totpKodu(q.json().gizli, suankiAdim()) }) as never));
  };
  return { db, sup, s, K, ist, gir, kapat: async () => { await s.close(); await db.end(); await sup.end(); } };
}

/** Bir öz denetim çalışmasını yürütür ve sonucu ana veritabanına yazar. */
export async function ozDenetimCalistir(db: Pool, kimlik: string, secenek: { vt?: string; havuz?: Senaryo[] } = {}): Promise<'Başarılı' | 'Başarısız' | 'Çalıştırılamadı'> {
  const c = (await db.query(`SELECT * FROM oz_denetim_calismasi WHERE kimlik = $1`, [kimlik])).rows[0]; if (!c) throw new Error('Çalışma bulunamadı');
  const havuz = secenek.havuz ?? SENARYOLAR;
  const dongu = Number((await db.query(`SELECT coalesce(max(dongu), 1) n FROM oz_denetim_sonucu`)).rows[0].n);
  const kullanilan = new Set((await db.query(`SELECT DISTINCT senaryo_kodu FROM oz_denetim_sonucu WHERE dongu = $1`, [dongu])).rows.map((r) => r.senaryo_kodu as string));
  const oncelikli = (await db.query(`SELECT DISTINCT s.surec FROM oz_denetim_sonucu s WHERE NOT s.basarili AND s.calisma_ref IN (SELECT kimlik FROM oz_denetim_calismasi WHERE kimlik <> $1 AND sonuc IN ('Başarılı', 'Başarısız') ORDER BY baslangic DESC LIMIT 2)`, [kimlik])).rows.map((r) => r.surec as string);
  const { secim, yeniDongu } = senaryoSec(havuz, kullanilan, oncelikli); const d = yeniDongu ? dongu + 1 : dongu;
  if (c.tur === 'Sürüm Öncesi') for (const k of (await db.query(`SELECT senaryo_kodu FROM oz_denetim_sabit_set`)).rows.map((r) => r.senaryo_kodu as string)) { const x = havuz.find((h) => h.kod === k); if (x && !secim.includes(x)) secim.push(x); }
  let o: (Ortam & { kapat: () => Promise<void> }) | null = null; const sonuclar: (Senaryo & Sonuc)[] = [];
  try {
    o = await ortamKur(secenek.vt ?? 'yatonet360_ozdenetim');
    for (const x of secim) { let r: Sonuc; try { r = await x.calistir(o); } catch (h) { r = { basarili: false, gerceklesen: `Hata: ${(h as Error).message.slice(0, 200)}` }; } sonuclar.push({ ...x, ...r }); }
  } catch (h) {
    await db.query(`UPDATE oz_denetim_calismasi SET sonuc = 'Çalıştırılamadı', aciklama = $2, bitis = now() WHERE kimlik = $1`, [kimlik, `Sentetik ortam kurulamadı: ${(h as Error).message.slice(0, 300)}`]);
    const bim = await rolSahipleri(db, await rolId(db, BIM));
    await bildir(db, { olay: `oz-denetim:${kimlik}:hata`, kullanicilar: bim, baslik: `${c.calisma_no} · Öz Denetim Çalıştırılamadı`, ozet: 'Sentetik ortam kurulamadı; kayıt ayrıntısına bakınız.', oncelik: 'Yüksek' });
    return 'Çalıştırılamadı';
  } finally { await o?.kapat().catch(() => {}); }
  const bimler = await rolSahipleri(db, await rolId(db, BIM)); const hedef = await isGunuSonu(db, new Date(), 10);
  for (const x of sonuclar) {
    let bulgu: string | null = null;
    if (!x.basarili) {
      await db.query(`INSERT INTO oz_denetim_sabit_set (senaryo_kodu, ilk_calisma_ref) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [x.kod, kimlik]);
      if (bimler[0]) {
        const yil = new Date().getFullYear(); const no = `PRB-${yil}-${String(await sayac(db, `sistem_bulgusu:${yil}`)).padStart(4, '0')}`;
        bulgu = (await db.query(`INSERT INTO sistem_bulgusu (bulgu_no, kosul, olcut, kanit, neden_risk, kapsam, kok_neden, sorumlu_ref, hedef_tarih, acan_ref) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$8) RETURNING kimlik`,
          [no, `${x.ad}: ${x.gerceklesen}`, x.beklenen, `${c.calisma_no} · ${x.kod}`, `${x.bulgu} bulgusu`, x.surec, 'Öz denetim bulgusu; kök neden analizi bekleniyor', bimler[0], hedef.toISOString().slice(0, 10)])).rows[0].kimlik;
        await kartAc(db, { tur: 'Sistem Bulgusu', kategori: 'gorev', baslik: `${no} · Öz Denetim Bulgusu · ${x.kod}`, sahipKullanici: bimler[0], sonZaman: hedef, nesneTuru: 'Bulgu', nesneKimligi: bulgu! });
      }
      if (['Yetki', 'Gizlilik'].includes(x.bulgu)) await kartAc(db, { tur: 'Öz Denetim Acil Bulgu', kategori: 'islem', baslik: `${c.calisma_no} · ${x.bulgu} Bulgusu · ${x.kod}`, ozet: `${x.ad}: ${x.gerceklesen}`, oncelik: 'Kritik', sahipRol: await rolId(db, BTD), nesneTuru: 'Öz Denetim', nesneKimligi: kimlik });
      const sahip = SUREC_SAHIBI[x.surec]; if (sahip) await bildir(db, { olay: `oz-denetim:${kimlik}:${x.kod}`, kullanicilar: await rolSahipleri(db, await rolId(db, sahip)), baslik: `Öz Denetim Bulgusu · ${x.surec}`, ozet: `${x.ad}: ${x.gerceklesen}` });
    }
    await db.query(`INSERT INTO oz_denetim_sonucu (calisma_ref, senaryo_kodu, surec, ad, senaryo_turu, beklenen, gerceklesen, basarili, dongu, bulgu_ref) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [kimlik, x.kod, x.surec, x.ad, x.tur, x.beklenen, x.gerceklesen, x.basarili, d, bulgu]);
  }
  const hata = sonuclar.filter((x) => !x.basarili).length; const sonuc = hata ? 'Başarısız' : 'Başarılı';
  const not = `${sonuclar.length} senaryo · ${hata} bulgu${hata && c.tur === 'Sürüm Öncesi' ? ' · Sürüm yayına alınmamıştır.' : ''}`;
  await db.query(`UPDATE oz_denetim_calismasi SET sonuc = $2, aciklama = $3, bitis = now() WHERE kimlik = $1`, [kimlik, sonuc, not]);
  await bildir(db, { olay: `oz-denetim:${kimlik}:ozet`, kullanicilar: bimler, baslik: `${c.calisma_no} · Öz Denetim ${sonuc}`, ozet: not });
  return sonuc;
}

async function calismaAc(db: Pool, tur: string, yayin: string | null, baslatan: string | null): Promise<{ kimlik: string; no: string } | null> {
  if ((await db.query(`SELECT 1 FROM oz_denetim_calismasi WHERE sonuc = 'Sürüyor' AND baslangic > now() - make_interval(mins => $1)`, [SURE_DK])).rowCount) return null;
  await db.query(`UPDATE oz_denetim_calismasi SET sonuc = 'Çalıştırılamadı', aciklama = 'Çalışma yarım kaldı', bitis = now() WHERE sonuc = 'Sürüyor'`);
  const yil = new Date().getFullYear(); const no = `ODN-${yil}-${String(await sayac(db, `oz_denetim:${yil}`)).padStart(4, '0')}`;
  const r = (await db.query(`INSERT INTO oz_denetim_calismasi (calisma_no, tur, yayin_ref, baslatan_ref) VALUES ($1,$2,$3,$4) RETURNING kimlik`, [no, tur, yayin, baslatan])).rows[0];
  return { kimlik: r.kimlik, no };
}

/** YG-1652: son öz denetim çalışmasından sonra kural veya parametre değişikliği var mı (ilk çalışmadan önce değişiklik sayılmaz). */
export async function kuralDegisikligiBekliyor(db: Pool): Promise<boolean> {
  return Boolean((await db.query(`SELECT 1 FROM kural_degisikligi WHERE zaman > (SELECT max(baslangic) FROM oz_denetim_calismasi) LIMIT 1`)).rowCount);
}

/** Saatlik iş: sıklık gününde İstanbul saatiyle 02:00'de bir kez çalışır; kural veya parametre değişikliğinden sonra (YG-1652) ilk saatlik turda kendiliğinden başlar. */
export async function ozDenetimZamanla(db: Pool, simdi = new Date()): Promise<boolean> {
  if (await kuralDegisikligiBekliyor(db)) { const c = await calismaAc(db, 'Kural Değişikliği', null, null); if (c) { await ozDenetimCalistir(db, c.kimlik); return true; } }
  const t = new Date(simdi.getTime() + 3 * 3_600_000); if (t.getUTCHours() !== 2) return false;
  const bas = Number((await db.query(`SELECT deger FROM sistem_parametresi WHERE kod = 'oz_denetim_baslangic'`)).rows[0]?.deger ?? 0);
  if (!ozDenetimGunuMu(bas, simdi) || !(await birKez(db, 'oz-denetim', t.toISOString().slice(0, 10)))) return false;
  const c = await calismaAc(db, 'Zamanlanmış', null, null); if (!c) return false;
  await ozDenetimCalistir(db, c.kimlik); return true;
}

export function ozDenetimYollari(s: FastifyInstance, b: Baglam) {
  const oturumlu = { preHandler: tamOturumGerekli(b) };
  const yok = (y: FastifyReply) => y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' });
  const yetkili = async (k: string) => Boolean((await b.db.query(`SELECT 1 FROM rol_atamasi a JOIN rol x ON x.kimlik = a.rol_ref WHERE a.kullanici_ref = $1 AND a.atama_durumu = 'Aktif' AND x.rol_adi = ANY($2::text[]) LIMIT 1`, [k, ROLLER])).rowCount);
  s.get('/oz-denetim', oturumlu, async (i, y) => {
    if (!(await yetkili(i.oturum!.kullanici))) return yok(y);
    const calismalar = (await b.db.query(`SELECT c.kimlik, c.calisma_no, c.tur, c.sonuc, c.aciklama, c.baslangic, c.bitis, ys.surum FROM oz_denetim_calismasi c LEFT JOIN yayin_seti ys ON ys.kimlik = c.yayin_ref ORDER BY c.baslangic DESC LIMIT 30`)).rows;
    const sonuclar = (await b.db.query(`SELECT s.calisma_ref, s.senaryo_kodu, s.surec, s.ad, s.senaryo_turu, s.beklenen, s.gerceklesen, s.basarili, g.bulgu_no FROM oz_denetim_sonucu s LEFT JOIN sistem_bulgusu g ON g.kimlik = s.bulgu_ref WHERE s.calisma_ref = ANY($1::uuid[]) ORDER BY s.zaman`, [calismalar.map((x) => x.kimlik)])).rows;
    const setler = (await b.db.query(`SELECT kimlik, surum, ortam FROM yayin_seti WHERE durum IN ('Hazırlandı', 'Test Edildi', 'Onayda') ORDER BY zaman DESC LIMIT 20`)).rows;
    return { calismalar: calismalar.map((x) => ({ ...x, sonuclar: sonuclar.filter((r) => r.calisma_ref === x.kimlik) })), setler, havuz: SENARYOLAR.length, sabit: (await b.db.query(`SELECT senaryo_kodu FROM oz_denetim_sabit_set ORDER BY senaryo_kodu`)).rows.map((r) => r.senaryo_kodu) };
  });
  // Sürüm öncesi ve kural/parametre değişikliği sonrası çalışma elle başlatılır; çalışma arka planda sürer.
  s.post('/oz-denetim', oturumlu, async (i, y) => {
    const o = i.oturum!; const g = (i.body ?? {}) as { tur?: string; yayin?: string };
    if (!(await yetkili(o.kullanici))) return yok(y);
    if (!['Sürüm Öncesi', 'Kural Değişikliği'].includes(g.tur ?? '')) return y.code(400).send({ hata: 'Çalışma türünü seçiniz.' });
    if (g.tur === 'Sürüm Öncesi' && (!g.yayin || !UUID.test(g.yayin) || !(await b.db.query(`SELECT 1 FROM yayin_seti WHERE kimlik = $1`, [g.yayin])).rowCount)) return y.code(400).send({ hata: 'Sürüm öncesi çalışmada yayın setini seçiniz.' });
    const c = await calismaAc(b.db, g.tur!, g.tur === 'Sürüm Öncesi' ? g.yayin! : null, o.kullanici); if (!c) return y.code(409).send({ hata: 'Sürmekte olan bir öz denetim çalışması vardır.' });
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Öz Denetim Başlatıldı', nesneTuru: 'Öz Denetim', nesneKimligi: c.kimlik, yeni: { tur: g.tur }, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    void ozDenetimCalistir(b.db, c.kimlik).catch((h) => s.log.error(h.message));
    return { kimlik: c.kimlik, calismaNo: c.no };
  });
}

/** Sürüm öncesi öz denetim başarılı değilse sürüm üretime alınmaz. */
export async function surumOzDenetimEngeli(db: Pool, setler: string[]): Promise<string | null> {
  const r = (await db.query(`SELECT sonuc FROM oz_denetim_calismasi WHERE tur = 'Sürüm Öncesi' AND yayin_ref = ANY($1::uuid[]) AND sonuc <> 'Sürüyor' ORDER BY baslangic DESC LIMIT 1`, [setler.filter((x) => x && UUID.test(x))])).rows[0];
  if (!r) return 'Sürüm öncesi öz denetim çalıştırılmadan sürüm yayına alınmaz.';
  return r.sonuc === 'Başarılı' ? null : 'Sürüm öncesi öz denetim başarısız; sürüm yayına alınmamıştır.';
}
