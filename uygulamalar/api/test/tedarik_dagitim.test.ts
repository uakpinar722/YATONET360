import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dagitimaAc } from '../src/tedarik_dagitim.js';
import { ortamKur, type Ortam } from './yardimci.js';

const KADRO = { ds: 'Dosya Sorumlusu', tu: 'Teknik Uzman', tyo: 'Tedarik Yöneticisi', tso: 'Tedarik Sorumlusu', tmy: 'Tedarik Müdür Yardımcısı' };
let o: Ortam;
beforeAll(async () => { o = await ortamKur('yatonet360_test120', KADRO); }, 120_000);
afterAll(async () => { await o.kapat(); });

describe('Talep Dağıtımı (YG-1592, YG-1593)', () => {
  it('onaylı malzeme talebi Tedarik Yöneticisine süreli görev açar; atama ve iade (T-YG1592)', async () => {
    const d = await o.dosyaAc(); await o.sup.query(`UPDATE dosya SET oncelik = 'Kritik' WHERE kimlik = $1`, [d.kimlik]);
    const yeni = async (n: string) => (await o.sup.query(`INSERT INTO form_kaydi (kayit_no, form_kodu, form_surumu, dosya_ref, hazirlayan_ref, durum, onay_zamani) VALUES ($1,'FR-MLZ-001',1,$2,$3,'Onaylı',now()) RETURNING kimlik`, [`${d.dosyaNo}-MT${n}`, d.kimlik, o.K.tu])).rows[0].kimlik as string;
    const f1 = await yeni('01'); const f2 = await yeni('02');
    const t0 = new Date(); await dagitimaAc(o.db, f1, t0); await dagitimaAc(o.db, f1, t0);
    const k = (await o.sup.query(`SELECT count(*)::int n, max(son_zaman) s FROM is_karti WHERE tur = 'Talep Dağıtımı' AND nesne_kimligi = $1`, [f1])).rows[0];
    expect(k.n).toBe(1); expect(Math.round((new Date(k.s).getTime() - t0.getTime()) / 3_600_000)).toBe(2);
    const v = (await o.ist('GET', '/api/tedarik-pano', await o.gir('tyo'))).json();
    expect(v.bekleyen.map((x: { kimlik: string }) => x.kimlik)).toEqual(expect.arrayContaining([f1, f2]));
    expect((await o.ist('GET', '/api/tedarik-pano', await o.gir('tmy'))).json().dagitir).toBe(false);
    expect((await o.ist('POST', `/api/tedarik/dagitim/${f1}`, await o.gir('tmy'), { sorumlu: o.K.tso })).statusCode).toBe(404);
    expect((await o.ist('POST', `/api/tedarik/dagitim/${f1}`, await o.gir('tyo'), { sorumlu: o.K.tso })).statusCode).toBe(200);
    expect(await o.kart('Malzeme Talebi', f1)).toBeDefined();
    // YG-1590 (T-YG1590): Tedarik Sorumlusu kendi talebini görür
    expect((await o.ist('GET', '/api/tedarik-sorumlusu-pano', await o.gir('tso'))).json().talepler.map((x: { kimlik: string }) => x.kimlik)).toContain(f1);
    expect((await o.ist('GET', '/api/tedarik-sorumlusu-pano', await o.gir('tyo'))).statusCode).toBe(404);
    { // T-YG1590-UYARI: banka hesabı değişikliği, eksik sertifika, raf ömrü
      const ted = (await o.sup.query(`INSERT INTO kurulus (sicil_no, ticari_unvan, kayit_rolu, olusturan_ref) VALUES ($1,'Uyarı Tedarikçi','Tedarikçi',$2) RETURNING kimlik`, [`S-TU${Date.now()}`, o.K.ds])).rows[0].kimlik;
      const s = (await o.sup.query(`INSERT INTO tedarik_siparisi (siparis_no, dosya_ref, kurulus_ref, tedarikci_teklif_ref, nihai_kullanim_yeri, kdv_haric_eur, kdv_eur, toplam_eur, teslim_tarihi, teslim_yeri, kabul_olcutu, secim_gerekcesi, hazirlayan_ref, statu) VALUES ('SP-UYARI-01',$1,$2,'T','Y',1,0,1,'2099-01-01','Y','K','G',$3,'Verildi') RETURNING kimlik`, [d.kimlik, ted, o.K.tso])).rows[0].kimlik;
      await o.sup.query(`INSERT INTO banka_hesabi (kurulus_ref, iban, giren_ref) VALUES ($1,'TR330006100519786457841326',$2)`, [ted, o.K.ds]);
      await o.sup.query(`INSERT INTO malzeme_giris_kabulu (kayit_no, siparis_ref, satir_no, miktar, lot_no, irsaliye_no, bekletme_yeri_ref, kontrol_eden_ref, hazirlayan_ref, son_kullanma) VALUES ('MG-UYARI-01',$1,1,1,'L-77','I-1',$2,$3,$3,current_date + 10)`, [s, ted, o.K.tso]);
      const u = (await o.ist('GET', '/api/tedarik-sorumlusu-pano', await o.gir('tso'))).json().uyarilar.filter((x: { siparis_no: string }) => x.siparis_no === 'SP-UYARI-01').map((x: { tur: string }) => x.tur).join(' | ');
      expect(u).toContain('Banka Hesabı Değişikliği'); expect(u).toContain('Raf Ömrü Doluyor (lot L-77');
      // T-YG1594: şüpheli ürün bildirimi ve kullanımı durdurma
      const mg = (await o.sup.query(`SELECT kimlik FROM malzeme_giris_kabulu WHERE kayit_no = 'MG-UYARI-01'`)).rows[0].kimlik;
      await o.sup.query(`INSERT INTO dosya_ekibi_atamasi (dosya_ref, kullanici_ref, rol, olusturan_ref) VALUES ($1,$2,'Teknik Uzman',$2)`, [d.kimlik, o.K.tu]);
      const tu = await o.gir('tu');
      expect((await o.ist('POST', `/api/malzeme-giris/${mg}/supheli`, tu, { gerekce: 'Ambalaj sahte görünüyor' })).statusCode).toBe(409); // henüz kabul yok
      await o.sup.query(`UPDATE malzeme_giris_kabulu SET kabul_karari = 'Kabul' WHERE kimlik = $1`, [mg]);
      expect((await o.ist('POST', `/api/malzeme-giris/${mg}/supheli`, tu, { gerekce: ' ' })).statusCode).toBe(400);
      expect((await o.ist('POST', `/api/malzeme-giris/${mg}/supheli`, tu, { gerekce: 'Ambalaj sahte görünüyor' })).statusCode).toBe(200);
      expect((await o.kart('Şüpheli Ürün', mg)).oncelik).toBe('Kritik');
      expect((await o.ist('GET', '/api/tedarik-pano', await o.gir('tmy'))).json().supheli.some((x: { kimlik: string }) => x.kimlik === mg)).toBe(true);
      expect((await o.ist('POST', `/api/malzeme-giris/${mg}/kullanimi-durdur`, await o.gir('tyo'), {})).statusCode).toBe(404);
      expect((await o.ist('POST', `/api/malzeme-giris/${mg}/kullanimi-durdur`, await o.gir('tmy'), {})).statusCode).toBe(200);
      expect((await o.sup.query(`SELECT kabul_karari FROM malzeme_giris_kabulu WHERE kimlik = $1`, [mg])).rows[0].kabul_karari).toBe('Karantina');
      expect(await o.kart('Karantina Kararı', mg)).toBeDefined();
      // T-YG1593: geri çağırma taraması lot ile etkilenen sipariş ve dosyayı bulur
      await o.sup.query(`INSERT INTO tedarik_siparisi_kalemi (siparis_ref, satir_no, urun_tanimi, uretici_parca_no, miktar, birim, birim_bedel_eur, toplam_eur) VALUES ($1,1,'Yakıt Filtresi','PN-4455',1,'Adet',1,1) ON CONFLICT DO NOTHING`, [s]);
      const gc = (await o.ist('GET', '/api/tedarik/geri-cagirma?lot=L-77', await o.gir('tmy'))).json();
      expect(gc.find((x: { kimlik: string }) => x.kimlik === mg)).toMatchObject({ siparis_no: 'SP-UYARI-01', dosya_no: d.dosyaNo });
      expect((await o.ist('GET', '/api/tedarik/geri-cagirma?lot=L', await o.gir('tmy'))).statusCode).toBe(400);
      expect((await o.ist('GET', '/api/tedarik/geri-cagirma?lot=L-77', await o.gir('tso'))).statusCode).toBe(404);
    }
    expect((await o.ist('POST', `/api/tedarik/dagitim/${f2}`, await o.gir('tyo'), { iadeGerekcesi: 'Teknik şart eksik' })).statusCode).toBe(200);
    expect((await o.sup.query(`SELECT durum, iade_nedeni FROM form_kaydi WHERE kimlik = $1`, [f2])).rows[0]).toEqual({ durum: 'Açık', iade_nedeni: 'Teknik şart eksik' });
    expect((await o.ist('GET', '/api/tedarik-pano', await o.gir('ds'))).statusCode).toBe(404);
  });
});
