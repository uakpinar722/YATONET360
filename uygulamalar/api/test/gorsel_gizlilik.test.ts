import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { disGonder } from '../src/bildirim.js';
import { hassasEkEngeli } from '../src/gorsel_gizlilik.js';
import { ortamKur, type Ortam } from './yardimci.js';

const KADRO = { ds: 'Dosya Sorumlusu' };
let o: Ortam;
beforeAll(async () => { o = await ortamKur('yatonet360_test111', KADRO); }, 120_000);
afterAll(async () => { await o.kapat(); });

describe('hassas görsel (YG-1165)', () => {
  it('hassas işaret gözden geçirme görevi açar; özgün dışarı gitmez, maskeli kopya gider; özgün değişmez', async () => {
    const d = await o.dosyaAc();
    await o.sup.query(`UPDATE dosya SET dosya_sorumlusu_ref = $2 WHERE kimlik = $1`, [d.kimlik, o.K.ds]);
    await o.sup.query(`INSERT INTO dosya_ekibi_atamasi (dosya_ref, kullanici_ref, rol, olusturan_ref) VALUES ($1,$2,'Dosya Sorumlusu',$2)`, [d.kimlik, o.K.ds]);
    const yeni = async (ad: string) => { const b = (await o.sup.query(`INSERT INTO belge (ad, belge_turu, bag_turu, bag_kimligi, kaynak_kanali, belge_tarihi, olusturan_ref) VALUES ($1,'Fotoğraf','Dosya',$2,'Sistem',current_date,$3) RETURNING kimlik`, [ad, d.kimlik, o.K.ds])).rows[0].kimlik as string;
      const s = (await o.sup.query(`INSERT INTO belge_surum (belge_ref, surum_no, dosya_adi, uzanti, boyut, ozet_sha256, depo_anahtari, tarama_kaynagi, yukleyen_ref) VALUES ($1,1,'a.jpg','jpg',1,repeat('a',64),'x','Test',$2) RETURNING kimlik`, [b, o.K.ds])).rows[0].kimlik as string; return { b, s }; };
    const oz = await yeni('Plaka görünen kare'); const kopya = await yeni('Plaka maskeli kare');
    const ds = await o.gir('ds');
    expect((await o.ist('POST', `/api/belge/${oz.b}/hassas`, ds, {})).statusCode).toBe(400);
    expect((await o.ist('POST', `/api/belge/${oz.b}/hassas`, ds, { neden: 'Plaka ve kişi yüzü' })).statusCode).toBe(200);
    expect((await o.kart('Hassas Görsel Erişim Gözden Geçirmesi', oz.b)).durum).toBe('Bekliyor');
    {
      expect(await hassasEkEngeli(o.db, [oz.s])).toMatch(/maskeli kopya/);
      expect(await disGonder(o.db, { olay: 'test-hassas', eposta: 'x@deneme.local', konu: 'K', metin: 'M', ekler: [oz.s] })).toBe(false);
      expect(await hassasEkEngeli(o.db, [kopya.s])).toBeNull();
    }
    expect((await o.ist('POST', `/api/belge/${oz.b}/maskeli-kopya`, ds, { kopya: kopya.b })).statusCode).toBe(200);
    expect((await o.kart('Hassas Görsel Erişim Gözden Geçirmesi', oz.b)).durum).toBe('Tamamlandı');
    expect((await o.sup.query(`SELECT hassas_icerik, bilgi_sinifi FROM belge WHERE kimlik = $1`, [oz.b])).rows[0]).toMatchObject({ hassas_icerik: true });
  });
});
