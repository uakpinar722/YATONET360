// Modül testlerinin ortak kurulumu: ayrı veritabanı, sentetik kadro, giriş ve dosya açma yardımcıları.
import type { FastifyInstance } from 'fastify';
import { expect } from 'vitest';
import pg from 'pg';
import { denemeHesaplari, kurVeritabani } from '../araclar/kurulum.js';
import { COOKIE_ADI, ortamOku } from '../src/ayarlar.js';
import { suankiAdim, totpKodu } from '../src/kripto.js';
import { parolaOzetle } from '../src/parola.js';
import { DenemeKutusu } from '../src/sms.js';
import { sunucuKur } from '../src/sunucu.js';

export const PAROLA = 'Sinama-Parolasi-2026!'; const D = '@deneme.yatonet.local';
const H = { 'x-yatonet': '1' };
const ckr = (r: any) => r.cookies.find((c: any) => c.name === COOKIE_ADI)?.value as string;

export interface Ortam {
  s: FastifyInstance; sup: pg.Client; db: pg.Pool; sms: DenemeKutusu; posta: DenemeKutusu; K: Record<string, string>;
  ist: (m: 'GET' | 'POST', url: string, c?: string, payload?: object) => Promise<any>;
  gir: (k: string) => Promise<string>;
  kart: (tur: string, nesne: string) => Promise<any>;
  karar: (id: string, k: string, kr: string, gerekce?: string) => Promise<any>;
  dosyaAc: (e?: Record<string, unknown>, ac?: Record<string, unknown>) => Promise<{ kimlik: string; dosyaNo: string; talep: any }>;
  ekipKur: (id: string) => Promise<void>;
  ata: (id: string, kim: string, rol: string, yapan: string, e?: object) => Promise<any>;
  belge: (id: string, k: string, ad?: string, uzanti?: string) => Promise<string>;
  kapat: () => Promise<void>;
}

export async function ortamKur(vt: string, kadro: Record<string, string>): Promise<Ortam> {
  const e = ortamOku();
  const a = new pg.Client({ host: 'localhost', user: 'postgres', password: e.POSTGRES_SUPER_PAROLA, database: 'postgres' });
  await a.connect(); await a.query(`DROP DATABASE IF EXISTS ${vt} WITH (FORCE)`); await a.end();
  const sup = await kurVeritabani(vt, { superParola: e.POSTGRES_SUPER_PAROLA!, uygulamaParola: e.YATONET_DB_PAROLA!, denemeHesap: false });
  await denemeHesaplari(sup, null);
  await sup.query(`UPDATE sistem_parametresi SET deger = 0 WHERE kod = 'sozlesme_kapisi'`); // YG-923: yalnız alacak.test.ts açar
  const oz = await parolaOzetle(PAROLA); const K: Record<string, string> = {};
  for (const [k, rol] of Object.entries(kadro)) {
    const { rows } = await sup.query(`INSERT INTO kullanici_hesabi (hesap_turu, kullanici_grubu, ad_soyad, kullanici_adi, e_posta, parola_ozeti, dogrulama_yontemi) VALUES ('İç Kullanıcı','LGM İç Rolü',$1,$2,$2,$3,'Doğrulama uygulaması (6 haneli kod)') RETURNING kimlik`, [`Deneme ${rol} ${k}`, k + D, oz]);
    K[k] = rows[0].kimlik;
    await sup.query(`INSERT INTO rol_atamasi (kullanici_ref, rol_ref) SELECT $1, kimlik FROM rol WHERE rol_adi = $2`, [K[k], rol]);
  }
  await sup.query(`UPDATE kullanici_hesabi SET parola_ozeti = $1, izin_adimi_zamani = now()`, [oz]);
  await sup.query(`INSERT INTO aydinlatma_kaydi (ilgili_kisi_ref, ilgili_kisi_grubu, aydinlatma_metni, metin_surumu, dil, sunum_kanali) SELECT kimlik, 'Çalışan', CASE WHEN kullanici_grubu = 'LGM İç Rolü' THEN 'KVKK-05' WHEN kullanici_grubu = 'İş Birliği Firması' THEN 'KVKK-03' ELSE 'KVKK-01' END, 'R00', 'Türkçe', 'Web' FROM kullanici_hesabi`);
  await sup.query(`INSERT INTO kullanim_kosullari_kabulu (kullanici_ref, prt_surumu, dil) SELECT kimlik, 'R00', 'Türkçe' FROM kullanici_hesabi`);
  await sup.query(`UPDATE sistem_parametresi SET deger = 0 WHERE kod = 'sigorta_teyit_bekleme_sn'`); // Bekleme sigorta_gonderim.test.ts içinde sınanır
  const db = new pg.Pool({ host: 'localhost', user: 'yatonet_uygulama', password: e.YATONET_DB_PAROLA, database: vt });
  const sms = new DenemeKutusu(null), posta = new DenemeKutusu(null);
  const s = await sunucuKur({ db, sms, eposta: posta, anahtar: 'ab'.repeat(32), guvenliCerez: false, webAdresi: 'http://x' });
  const oturum: Record<string, string> = {};
  const ist: Ortam['ist'] = async (m, url, c, payload) => s.inject({ method: m, url, headers: H, cookies: c ? { [COOKIE_ADI]: c } : {}, payload });
  const gir = async (k: string) => {
    if (oturum[k]) return oturum[k]!;
    const c = ckr(await s.inject({ method: 'POST', url: '/api/kimlik/giris', headers: H, payload: { kimlik: k + D, parola: PAROLA } }));
    const q = await ist('GET', '/api/kimlik/kurulum', c);
    return (oturum[k] = ckr(await ist('POST', '/api/kimlik/dogrula', c, { kod: totpKodu(q.json().gizli, suankiAdim()) })));
  };
  let n = 0;
  const ata: Ortam['ata'] = async (id, kim, rol, yapan, x = {}) => ist('POST', `/api/dosya/${id}/ekip`, await gir(yapan), { kullanici: K[kim], rol, ...x });
  return {
    s, sup, db, sms, posta, K, ist, gir, ata,
    kart: async (tur, nesne) => (await sup.query(`SELECT * FROM is_karti WHERE tur = $1 AND nesne_kimligi = $2 ORDER BY olusturma_zamani DESC LIMIT 1`, [tur, nesne])).rows[0],
    karar: async (id, k, kr, gerekce) => ist('POST', `/api/is/${id}/karar`, await gir(k), { karar: kr, gerekce }),
    dosyaAc: async (x = {}, ac = {}) => {
      const c = await gir('ds');
      const t = await ist('POST', '/api/ihbar', c, { kanal: 'Telefon', sahibiAdi: 'Kaptan', sahibiTuru: 'Yatın Kaptanı', yetkiDurumu: 'Doğrulandı', telefon: '+905550001111', konum: 'Marmaris', yatDurumu: 'Bağlı', ihtiyac: 'Hasar', yat: { adi: `Yat ${vt} ${++n}`, markaDiger: 'M', modelDiger: 'N', boy: 14, govde: 'Fiber', tur: 'Motor Yat' }, yatSahibi: { ad: 'Sahip', telefon: '+905550002222', eposta: `sahip${n}@deneme.yatonet.local` }, cevaplar: {}, ...x });
      expect(t.statusCode, t.body).toBe(200);
      await ist('POST', `/api/ihbar/${t.json().kimlik}/mukerrerlik`, c, { sonuc: 'Mükerrer değil' });
      const r = await ist('POST', `/api/ihbar/${t.json().kimlik}/acilis`, c, { karar: 'Kabul', ozet: 'Açılış', musteriTuru: 'Bireysel Müşteri', ...ac });
      expect(r.statusCode, r.body).toBe(200);
      return { ...r.json(), talep: t.json() };
    },
    ekipKur: async (id) => {
      for (const [kim, rol, yapan] of [['ds', 'Dosya Sorumlusu', 'opm'], ['oy', 'Operasyon Yöneticisi', 'opm'], ['tu', 'Teknik Uzman', 'tm'], ['ty', 'Teknik Yönetici', 'tm']] as const) {
        const r = await ata(id, kim, rol, yapan); expect(r.statusCode, r.body).toBe(200);
      }
      await sup.query(`INSERT INTO dosya_yat_degeri (dosya_ref, durum, deger_eur, ek_police_durumu) VALUES ($1,'Kesin',10000000,'Gerekli değil') ON CONFLICT DO NOTHING`, [id]); // Kapı; asıl akış yat_degeri.test.ts içinde
      await sup.query(`INSERT INTO teknik_rapor (rapor_no, rapor_turu, dosya_ref, kapsam, incelenen_alan, saha_kosullari, yontem_olcut, bulgular, acik_sorular, analiz_risk, oneriler, uzmanlik_siniri, durum, hazirlayan_ref) SELECT dosya_no || '-RPX', 'İlk Rapor', kimlik, 'K', 'İ', 'S', 'Y', 'B', 'A', 'N', 'Ö', 'U', 'Onaylı', $2 FROM dosya WHERE kimlik = $1`, [id, K.tu]); // Kapı; asıl akış onay_rapor.test.ts içinde
    },
    belge: async (id, k, ad = `B${Math.random()}`, uzanti = 'pdf') => {
      const icerik = uzanti === 'pdf' ? Buffer.from(`%PDF-1.4 ${Math.random()}`) : Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from(String(Math.random()))]);
      const r = await s.inject({ method: 'POST', url: `/api/belge/yukle?ad=${encodeURIComponent(ad)}&tur=Foto&bagTuru=Dosya&bagKimligi=${id}&kaynak=${encodeURIComponent('Sistem')}&dosya=k.${uzanti}`, headers: { ...H, 'content-type': 'application/octet-stream' }, cookies: { [COOKIE_ADI]: await gir(k) }, payload: icerik });
      expect(r.statusCode, r.body).toBe(200);
      return r.json().belge as string;
    },
    kapat: async () => { await s.close(); await db.end(); await sup.end(); },
  };
}
export const ana = { H, ckr };
