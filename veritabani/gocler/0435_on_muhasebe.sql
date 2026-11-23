-- YG-1080, YG-917: ön muhasebe; genel gider ve banka/kasa hareketi kaydı (resmî defter değildir).
CREATE TABLE genel_gider (kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), tarih date NOT NULL, kalem text NOT NULL, tutar_eur numeric(14,2) NOT NULL CHECK (tutar_eur > 0), belge_ref uuid REFERENCES belge (kimlik), aciklama text, giren_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), olusturma_zamani timestamptz NOT NULL DEFAULT now());
CREATE TABLE hesap_hareketi (kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), hesap_turu text NOT NULL CHECK (hesap_turu IN ('Banka', 'Kasa')), hesap_adi text NOT NULL, tarih date NOT NULL, yon text NOT NULL CHECK (yon IN ('Giriş', 'Çıkış')), tutar_eur numeric(14,2) NOT NULL CHECK (tutar_eur > 0), aciklama text NOT NULL,
  cari_turu text CHECK (cari_turu IN ('Müşteri', 'Sigorta Şirketi', 'Çözüm Ortağı', 'Tedarikçi')), cari_ref text, giren_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), olusturma_zamani timestamptz NOT NULL DEFAULT now(), CHECK ((cari_turu IS NULL) = (cari_ref IS NULL)));
GRANT SELECT, INSERT ON genel_gider, hesap_hareketi TO yatonet_uygulama;
CREATE OR REPLACE VIEW mali_hareket AS
  SELECT 'Gelir'::text tur, 'Müşteri Faturası'::text kaynak, f.kimlik kaynak_ref, f.dosya_ref, coalesce(f.fatura_tarihi, f.olusturma_zamani::date) tarih, f.kdv_haric_eur tutar_eur, coalesce(f.fatura_no, f.proforma_no) belge_no
    FROM musteri_faturasi f WHERE f.durum IN ('Faturalandı', 'Kısmi Tahsil', 'Tahsil Edildi')
  UNION ALL SELECT 'Maliyet', 'Hakediş', h.kimlik, h.dosya_ref, h.olusturma_zamani::date, h.bu_donem_brut, h.hakedis_no FROM hakedis h WHERE h.statu IN ('Doğrulandı', 'Ödeme Talimatında', 'Ödendi')
  UNION ALL SELECT 'Maliyet', 'Tedarikçi Faturası', t.kimlik, s.dosya_ref, t.tarih, t.tutar_eur, t.fatura_no FROM tedarikci_faturasi t JOIN tedarik_siparisi s ON s.kimlik = t.siparis_ref
  UNION ALL SELECT 'Maliyet', 'Personel Masrafı', m.kimlik, NULL::uuid, m.fis_tarihi, m.odenecek_eur, m.belge_ozeti FROM personel_masraf_fisi m WHERE m.durum = 'Onaylandı'
  UNION ALL SELECT 'Maliyet', 'Genel Gider', g.kimlik, NULL::uuid, g.tarih, g.tutar_eur, g.kalem FROM genel_gider g
  UNION ALL SELECT 'Nakit Giriş', 'Tahsilat', c.kimlik, c.dosya_ref, c.tarih, c.tutar_eur, c.referans FROM tahsilat c
  UNION ALL SELECT 'Nakit Çıkış', 'Firma Ödemesi', o.kimlik, h.dosya_ref, o.planlanan_tarih, o.tutar_eur, h.hakedis_no FROM odeme_talimati o JOIN hakedis h ON h.kimlik = o.hakedis_ref WHERE o.durum = 'Ödendi';
GRANT SELECT ON mali_hareket TO yatonet_uygulama;
