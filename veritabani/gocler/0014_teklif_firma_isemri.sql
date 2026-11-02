-- Kartela, firma sicili (çekirdek), kapsam cetveli, firma teklifi, LGM Fiyat Teklifi, sigorta kararı, cayma, iş emri ve firma portalı.
CREATE TABLE sistem_parametresi (kod text PRIMARY KEY, deger numeric NOT NULL, aciklama text NOT NULL, gecerlilik date NOT NULL DEFAULT current_date);
-- K-104: katsayı belgelere yazılmaz, parametrededir. YG-187: bant oranı. YG-173: parasal limitler (KDV hariç EUR).
INSERT INTO sistem_parametresi (kod, deger, aciklama) VALUES
  ('fiyat_katsayisi', 1.3, 'Satış fiyatı = firma birim fiyatı × katsayı'),
  ('bant_orani', 0.15, 'Kartela bandı: maliyet × katsayı ± oran'),
  ('limit_tid_eur', 5000, 'Ticari İşler Direktörü son onay limiti'),
  ('limit_gmy_eur', 10000, 'Genel Müdür Yardımcısı son onay limiti'),
  ('teklif_gecerlilik_gun', 15, 'LGM Fiyat Teklifi geçerliliği'),
  ('firma_teklif_gecerlilik_gun', 30, 'Firma ve tedarikçi teklifi geçerliliği'),
  ('cayma_gun', 14, 'Bireysel müşteri cayma süresi'),
  ('saha_sorumlusu_esik_eur', 5000, 'Saha Sorumlusu zorunluluğu eşiği'),
  ('kdv_orani', 20, 'Genel KDV oranı (%)');
GRANT SELECT ON sistem_parametresi TO yatonet_uygulama;

CREATE TABLE kartela_surumu (surum text PRIMARY KEY, durum text NOT NULL CHECK (durum IN ('Taslak', 'Yürürlükte', 'Arşiv')), yururluk date);
CREATE TABLE kartela_kalemi (
  kod text NOT NULL, surum text NOT NULL REFERENCES kartela_surumu (surum), ana_brans text NOT NULL, alt_brans text NOT NULL, tali_brans text NOT NULL, islem text NOT NULL, birim text NOT NULL, maliyet_eur numeric(12,2) NOT NULL CHECK (maliyet_eur >= 0),
  PRIMARY KEY (kod, surum)
);
CREATE INDEX kartela_islem ON kartela_kalemi (lower(islem));
CREATE TABLE kartela_birlikte_yazilmaz (grup text PRIMARY KEY, kodlar text[] NOT NULL, notu text NOT NULL);
GRANT SELECT ON kartela_surumu, kartela_kalemi, kartela_birlikte_yazilmaz TO yatonet_uygulama;

CREATE TABLE kurulus (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), sicil_no text NOT NULL UNIQUE, ticari_unvan text NOT NULL CHECK (length(trim(ticari_unvan)) > 0), vergi_no text UNIQUE, kayit_rolu text NOT NULL CHECK (kayit_rolu IN ('Çözüm Ortağı', 'Tedarikçi', 'Tesis')),
  kayit_asamasi text NOT NULL DEFAULT 'Başvuru' CHECK (kayit_asamasi IN ('Aday', 'Başvuru', 'İncelemede', 'Onaylı', 'Koşullu Onaylı', 'Reddedildi')),
  ag_statusu text NOT NULL DEFAULT 'Pasif' CHECK (ag_statusu IN ('Aktif', 'Kısıtlı', 'Geçici Askıda', 'Askıda', 'Çıkarıldı', 'Pasif')),
  risk_derecesi text CHECK (risk_derecesi IN ('Tercihli', 'Standart', 'Yakın İzleme')), acil_hizmet_verir boolean NOT NULL DEFAULT false, kurumsal_eposta text, kurumsal_telefon text, il text, ilce text,
  olusturma_zamani timestamptz NOT NULL DEFAULT now(), olusturan_ref text REFERENCES kullanici_hesabi (kimlik), guncelleme_zamani timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE kurulus_kullanici (kurulus_ref uuid NOT NULL REFERENCES kurulus (kimlik), kullanici_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), PRIMARY KEY (kurulus_ref, kullanici_ref));
CREATE TABLE brans_yetkinligi (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), kurulus_ref uuid NOT NULL REFERENCES kurulus (kimlik), ana_brans text NOT NULL, kapsama text NOT NULL DEFAULT 'Bölge' CHECK (kapsama IN ('Bölge', 'Komşu', 'Mobil Ekip', 'Ulusal')), bolge text, yetkinlik_seviyesi text CHECK (yetkinlik_seviyesi IN ('Y1', 'Y2', 'Y3', 'Y4')), durum text NOT NULL DEFAULT 'Aktif' CHECK (durum IN ('Aktif', 'Pasif', 'Doğrulama Bekliyor')),
  UNIQUE (kurulus_ref, ana_brans, kapsama, bolge)
);
CREATE TABLE sicil_belgesi (kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), kurulus_ref uuid NOT NULL REFERENCES kurulus (kimlik), tur text NOT NULL, gecerlilik_bitis date, belge_ref uuid REFERENCES belge (kimlik), kontrol_eden_ref text REFERENCES kullanici_hesabi (kimlik), olusturma_zamani timestamptz NOT NULL DEFAULT now());
GRANT SELECT, INSERT, UPDATE ON kurulus, kurulus_kullanici, brans_yetkinligi, sicil_belgesi TO yatonet_uygulama;

-- YG-195, YG-198: teklif satırları cetvelden üretilir; cetvel sürümlü, onayı Teknik Yöneticide.
CREATE TABLE kapsam_cetveli (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), dosya_ref uuid NOT NULL REFERENCES dosya (kimlik), surum integer NOT NULL, durum text NOT NULL DEFAULT 'Taslak' CHECK (durum IN ('Taslak', 'Onayda', 'Onaylı', 'Yerine Geçti')), hazirlayan_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), onaylayan_ref text REFERENCES kullanici_hesabi (kimlik), onay_zamani timestamptz, dahil_haric text, varsayimlar text, olusturma_zamani timestamptz NOT NULL DEFAULT now(), UNIQUE (dosya_ref, surum)
);
CREATE TABLE kapsam_satiri (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), cetvel_ref uuid NOT NULL REFERENCES kapsam_cetveli (kimlik), satir_kodu text NOT NULL, bolge_kodu text, kartela_kodu text, kartela_disi boolean NOT NULL DEFAULT false, aciklama text NOT NULL, isin_niteligi text NOT NULL, bedel_turu text NOT NULL, miktar numeric(14,3) NOT NULL CHECK (miktar > 0), birim text NOT NULL, kabul_sinifi text CHECK (kabul_sinifi IN ('A', 'B', 'C', 'D')), gecici_onarim boolean NOT NULL DEFAULT false, UNIQUE (cetvel_ref, satir_kodu)
);

CREATE TABLE firma_fiyat_teklifi (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), teklif_no text NOT NULL UNIQUE, dosya_ref uuid NOT NULL REFERENCES dosya (kimlik), kurulus_ref uuid NOT NULL REFERENCES kurulus (kimlik), cetvel_ref uuid REFERENCES kapsam_cetveli (kimlik), durum text NOT NULL DEFAULT 'Taslak' CHECK (durum IN ('Taslak', 'Gönderildi', 'Seçildi', 'Seçilmedi', 'Süresi Doldu')), gecerlilik date NOT NULL, toplam_eur numeric(14,2), giren_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), olusturma_zamani timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE firma_fiyat_kalemi (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), teklif_ref uuid NOT NULL REFERENCES firma_fiyat_teklifi (kimlik), satir_ref uuid NOT NULL REFERENCES kapsam_satiri (kimlik), birim_fiyat_eur numeric(12,2) NOT NULL CHECK (birim_fiyat_eur >= 0), eski_fiyat_eur numeric(12,2), duzeltme_gerekcesi text, UNIQUE (teklif_ref, satir_ref)
);

CREATE TABLE fiyat_teklifi (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), teklif_no text NOT NULL, surum_no integer NOT NULL DEFAULT 1, onceki_surum_ref uuid REFERENCES fiyat_teklifi (kimlik), teklif_turu text NOT NULL DEFAULT 'Fiyat Teklifi', ana_teklif_ref uuid REFERENCES fiyat_teklifi (kimlik), dosya_ref uuid NOT NULL REFERENCES dosya (kimlik), cetvel_ref uuid REFERENCES kapsam_cetveli (kimlik), revizyon_nedeni text,
  teklif_muhatabi text NOT NULL CHECK (teklif_muhatabi IN ('Sigorta Şirketi', 'Yat Sahibi', 'Kurumsal Müşteri')), teklif_dili text NOT NULL DEFAULT 'Türkçe', ara_toplam_eur numeric(14,2) NOT NULL DEFAULT 0, opsiyon_toplami_eur numeric(14,2) NOT NULL DEFAULT 0, indirim_orani integer CHECK (indirim_orani BETWEEN 1 AND 10), indirim_tutari_eur numeric(14,2) NOT NULL DEFAULT 0, indirim_gerekcesi text, kesif_mahsubu_eur numeric(14,2) NOT NULL DEFAULT 0, kdv_orani numeric(5,2) NOT NULL, kdv_tutari_eur numeric(14,2) NOT NULL DEFAULT 0, genel_toplam_eur numeric(14,2) NOT NULL DEFAULT 0, onay_limit_tutari_eur numeric(14,2) NOT NULL DEFAULT 0,
  gecerlilik_bitis_tarihi date, odeme_vadesi text, fatura_bilgisi text, statu text NOT NULL DEFAULT 'Taslak' CHECK (statu IN ('Taslak', 'İç Onayda', 'Onaylı', 'Gönderildi', 'Karar', 'Süresi Doldu', 'Yerine Geçti', 'Reddedildi', 'Geri Çekildi')), karar text, karar_zamani timestamptz, kilitli boolean NOT NULL DEFAULT false, bant_disi_onay_ref text REFERENCES kullanici_hesabi (kimlik), bant_disi_gerekce text, hazirlayan_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), son_onay_makami text, gonderim_zamani timestamptz,
  olusturma_zamani timestamptz NOT NULL DEFAULT now(), guncelleme_zamani timestamptz NOT NULL DEFAULT now(), UNIQUE (teklif_no, surum_no)
);
CREATE INDEX fiyat_teklifi_dosya ON fiyat_teklifi (dosya_ref);
CREATE TABLE fiyat_teklifi_kalemi (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), teklif_ref uuid NOT NULL REFERENCES fiyat_teklifi (kimlik), sira_no integer NOT NULL, satir_ref uuid REFERENCES kapsam_satiri (kimlik), kartela_kodu text, kartela_surumu text, kartela_disi boolean NOT NULL DEFAULT false, aciklama text NOT NULL, isin_niteligi text NOT NULL, bedel_turu text NOT NULL, miktar numeric(14,3) NOT NULL, birim text NOT NULL, firma_kalem_ref uuid REFERENCES firma_fiyat_kalemi (kimlik), birim_maliyet_eur numeric(12,2), birim_satis_fiyati_eur numeric(12,2) NOT NULL, tutar_eur numeric(14,2) NOT NULL, bant_disi boolean NOT NULL DEFAULT false, opsiyon boolean NOT NULL DEFAULT false, onay_durumu text NOT NULL DEFAULT 'Bekliyor' CHECK (onay_durumu IN ('Bekliyor', 'Onaylandı', 'Onaylanmadı')), UNIQUE (teklif_ref, sira_no)
);
CREATE TABLE sigorta_onayi (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), dosya_ref uuid NOT NULL REFERENCES dosya (kimlik), teklif_ref uuid NOT NULL REFERENCES fiyat_teklifi (kimlik), karar text NOT NULL, onaylanan_tutar_eur numeric(14,2), onay_kanali text NOT NULL, onay_tarihi timestamptz NOT NULL, onay_belgesi_ref uuid REFERENCES belge (kimlik), onaylayan_yetkili text NOT NULL, kaydi_yapan_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), olusturma_zamani timestamptz NOT NULL DEFAULT now()
);
-- YG-152, YG-467, YG-468: cayma hesabı yalnız bireysel dosyada.
CREATE TABLE on_bilgilendirme_cayma_kaydi (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), teklif_ref uuid NOT NULL UNIQUE REFERENCES fiyat_teklifi (kimlik), dosya_ref uuid NOT NULL REFERENCES dosya (kimlik), on_bilgilendirme_zamani timestamptz NOT NULL, sozlesme_zamani timestamptz NOT NULL, cayma_bitis timestamptz NOT NULL, erken_ifa_onayi boolean NOT NULL DEFAULT false, cayma_zamani timestamptz, iade_son_tarihi date
);

CREATE TABLE is_emri (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), is_emri_no text NOT NULL, surum integer NOT NULL DEFAULT 1, is_emri_turu text NOT NULL CHECK (is_emri_turu IN ('KN', 'AC', 'ON', 'EK', 'GR', 'PH')), ana_is_emri_ref uuid REFERENCES is_emri (kimlik), dosya_ref uuid NOT NULL REFERENCES dosya (kimlik), teklif_ref uuid REFERENCES fiyat_teklifi (kimlik), kurulus_ref uuid NOT NULL REFERENCES kurulus (kimlik), uygulama_yeri text NOT NULL, kapsam text NOT NULL, firma_bedeli_eur numeric(14,2), baslangic_tarihi date, hedef_bitis_tarihi date, tehlikeli_atik boolean NOT NULL DEFAULT false, atik_teslim_belgesi_ref uuid REFERENCES belge (kimlik),
  statu text NOT NULL DEFAULT 'Taslak' CHECK (statu IN ('Taslak', 'İç Onayda', 'Kabul Bekliyor', 'Başlangıç Kontrolünde', 'Aktif', 'Tamamlandı', 'Kapalı', 'Çekinceli', 'Durduruldu', 'İptal', 'Yerine Geçti')), firma_yaniti text, firma_kabul_eden_ref text REFERENCES kullanici_hesabi (kimlik), firma_kabul_zamani timestamptz, yanit_son timestamptz, cekince_aciklamasi text, durdurma_nedeni text, baslangic_sonucu text, hazirlayan_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), yayim_zamani timestamptz, teknik_kabul_sonucu text, teknik_kabul_eden_ref text REFERENCES kullanici_hesabi (kimlik), olusturma_zamani timestamptz NOT NULL DEFAULT now(), guncelleme_zamani timestamptz NOT NULL DEFAULT now(), UNIQUE (is_emri_no, surum)
);
CREATE INDEX is_emri_dosya ON is_emri (dosya_ref);
CREATE INDEX is_emri_firma ON is_emri (kurulus_ref, statu);
CREATE TABLE is_emri_kalemi (is_emri_ref uuid NOT NULL REFERENCES is_emri (kimlik), teklif_kalem_ref uuid REFERENCES fiyat_teklifi_kalemi (kimlik), satir_ref uuid REFERENCES kapsam_satiri (kimlik), aciklama text NOT NULL, miktar numeric(14,3) NOT NULL, birim text NOT NULL, gerceklesen_miktar numeric(14,3) NOT NULL DEFAULT 0, PRIMARY KEY (is_emri_ref, aciklama));
CREATE TABLE is_emri_ilerleme (kimlik bigserial PRIMARY KEY, is_emri_ref uuid NOT NULL REFERENCES is_emri (kimlik), aciklama text NOT NULL, miktar numeric(14,3) NOT NULL, belge_ref uuid REFERENCES belge (kimlik), giren_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), zaman timestamptz NOT NULL DEFAULT now(), dogrulandi boolean NOT NULL DEFAULT false, dogrulayan_ref text REFERENCES kullanici_hesabi (kimlik));
GRANT SELECT, INSERT, UPDATE ON kapsam_cetveli, kapsam_satiri, firma_fiyat_teklifi, firma_fiyat_kalemi, fiyat_teklifi, fiyat_teklifi_kalemi, sigorta_onayi, on_bilgilendirme_cayma_kaydi, is_emri, is_emri_kalemi, is_emri_ilerleme TO yatonet_uygulama;
GRANT USAGE ON SEQUENCE is_emri_ilerleme_kimlik_seq TO yatonet_uygulama;
