-- Yat ana verisi, taraf, ihbar (talep) ve teknik dosya çekirdeği. Alan adları Alan Sözlüğü LGM-2026-014'ten; başvurular _ref ekiyle.
CREATE TABLE numara_sayaci (anahtar text PRIMARY KEY, son integer NOT NULL);

CREATE TABLE yat_marka_model (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  marka_kodu text NOT NULL, marka text NOT NULL, model text NOT NULL,
  turkiye_kaynakli boolean NOT NULL DEFAULT false, katalog_seri integer, katalog_no text,
  tekne_turu text, boy_m numeric(6,2), govde_malzemesi text, tahrik_turu text,
  fotograf text, teknik_veri text, durum text,
  kaynak text NOT NULL DEFAULT 'LGM-2026-012',
  olusturma_zamani timestamptz NOT NULL DEFAULT now(), guncelleme_zamani timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX yat_marka_model_tekil ON yat_marka_model (lower(marka), lower(model));
CREATE INDEX yat_marka_model_marka ON yat_marka_model (lower(marka));

CREATE TABLE taraf (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  taraf_no text NOT NULL UNIQUE,
  kisi_turu text NOT NULL CHECK (kisi_turu IN ('Gerçek kişi', 'Tüzel kişi')),
  musteri_turu text CHECK (musteri_turu IN ('Sigorta Şirketi', 'Kurumsal Müşteri', 'Bireysel Müşteri')),
  taraf_rolleri text[] NOT NULL DEFAULT '{}',
  unvan_ad_soyad text NOT NULL CHECK (length(trim(unvan_ad_soyad)) > 0),
  vergi_dairesi text, vergi_no text CHECK (vergi_no ~ '^[0-9]{10}$'), tckn text CHECK (tckn ~ '^[0-9]{11}$'), mersis_no text,
  adres text, il text, ulke text NOT NULL DEFAULT 'TR', telefon text, eposta text, kep_adresi text, kurumsal_onay_epostasi text,
  kullanici_ref text REFERENCES kullanici_hesabi (kimlik),
  risk_olayi text, tarama_sonucu text CHECK (tarama_sonucu IN ('Temiz', 'İnceleme', 'Ret')),
  durum text NOT NULL DEFAULT 'Aktif' CHECK (durum IN ('Aktif', 'Pasif')),
  bilgi_sinifi text NOT NULL DEFAULT 'Gizli',
  olusturma_zamani timestamptz NOT NULL DEFAULT now(), olusturan_ref text REFERENCES kullanici_hesabi (kimlik), guncelleme_zamani timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX taraf_ad ON taraf (lower(unvan_ad_soyad));
CREATE UNIQUE INDEX taraf_vergi ON taraf (vergi_no) WHERE vergi_no IS NOT NULL;
CREATE UNIQUE INDEX taraf_tckn ON taraf (tckn) WHERE tckn IS NOT NULL;

CREATE TABLE yat (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  yat_adi text NOT NULL CHECK (length(trim(yat_adi)) > 0),
  tur text, bayrak text, kullanim_amaci text, klas_durumu text CHECK (klas_durumu IN ('Evet', 'Hayır', 'Bilinmiyor')), klas_kurulusu text, tabi_kod text,
  yabanci_yat_belgesi text, yabanci_yat_belge_no text, yabanci_yat_belge_gecerlilik date, gecici_ithalat_bitis date, turkiye_kalis_bitis date,
  sicil_bilgisi text, govde_no text, imo_no text, cagri_isareti text,
  marka_model_ref uuid REFERENCES yat_marka_model (kimlik), marka_diger text, model_diger text, diger_onay_durumu text,
  katalog_teyit text CHECK (katalog_teyit IN ('Katalogdan – teyit bekliyor', 'Teyit edildi', 'Düzeltildi')),
  uretim_yili integer CHECK (uretim_yili BETWEEN 1900 AND 2100), tam_boy_m numeric(6,2) CHECK (tam_boy_m > 0), tonaj numeric(10,2),
  govde_tipi text, govde_malzemesi text CHECK (govde_malzemesi IN ('Fiber', 'Ahşap', 'Çelik', 'Alüminyum', 'Bilinmiyor')), tahrik_turu text,
  boy_kaynagi text, govde_kaynagi text,
  -- YG-116: yat değeri elle girilemez; yalnız sistem yazar.
  yat_degeri_eur numeric(14,2), yat_degeri_guven text CHECK (yat_degeri_guven IN ('A', 'B', 'C', 'D')), yat_degeri_kademe integer CHECK (yat_degeri_kademe BETWEEN 1 AND 6), yat_degeri_ilan_sayisi integer, yat_degeri_tarihi date,
  yat_sahibi_ref uuid REFERENCES taraf (kimlik),
  mulkiyet_turu text, takyidat text[] NOT NULL DEFAULT '{}', lehtar_ref uuid REFERENCES taraf (kimlik), lehtar_muvafakati_ref uuid, beyan_zamani timestamptz, beyan_eden_ref text REFERENCES kullanici_hesabi (kimlik),
  gecici_kayit boolean NOT NULL DEFAULT false,
  dogrulama_durumu text NOT NULL DEFAULT 'Beyan' CHECK (dogrulama_durumu IN ('Beyan', 'Doğrulandı', 'Doğrulanamadı')),
  olusturma_zamani timestamptz NOT NULL DEFAULT now(), olusturan_ref text REFERENCES kullanici_hesabi (kimlik), guncelleme_zamani timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX yat_ad ON yat (lower(yat_adi));
CREATE UNIQUE INDEX yat_govde ON yat (lower(govde_no)) WHERE govde_no IS NOT NULL;
CREATE UNIQUE INDEX yat_imo ON yat (imo_no) WHERE imo_no IS NOT NULL;

CREATE TABLE talep (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  talep_no text NOT NULL UNIQUE,
  bildirim_alinma_zamani timestamptz NOT NULL,
  kayda_gecis_zamani timestamptz NOT NULL DEFAULT now(),
  ilk_yanit_zamani timestamptz,
  ihbar_alindi_varyanti text NOT NULL DEFAULT 'Hasar',
  bildirim_kanali text NOT NULL,
  talebi_alan_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik),
  talep_sahibi_adi text NOT NULL CHECK (length(trim(talep_sahibi_adi)) > 0),
  talep_sahibi_turu text NOT NULL, talep_sahibi_turu_aciklama text,
  ihbar_yetki_durumu text NOT NULL, talep_sahibi_sifat text,
  talep_sahibi_telefon text, talep_sahibi_eposta text, yetki_dayanagi_beyani text,
  yat_ref uuid NOT NULL REFERENCES yat (kimlik),
  olay_tarihi timestamptz, olay_yeri text, yat_mevcut_konumu text NOT NULL, yat_mevcut_durumu text NOT NULL, ihtiyac_tanimi text NOT NULL,
  acil_durum boolean NOT NULL DEFAULT false,
  oncelik_cevaplari jsonb NOT NULL DEFAULT '{}',
  onerilen_oncelik text NOT NULL, oncelik text NOT NULL, musteri_hedef_tarihi date,
  sigortaci_beyan text, police_no_beyan text, sigorta_hasar_dosya_no_beyan text,
  ozgun_bildirim text NOT NULL,
  mukerrerlik_sonucu text CHECK (mukerrerlik_sonucu IN ('Mükerrer değil', 'Mevcut dosyaya bağlandı', 'Ayrı olay (gerekçeli)')),
  mukerrer_dosya_ref uuid, ayrim_gerekcesi text,
  statu text NOT NULL DEFAULT 'Yeni Talep' CHECK (statu IN ('Yeni Talep', 'Doğrulama Bekliyor', 'Teknik Ön İnceleme', 'Acil Eskalasyon', 'Kapsam Dışı / Yönlendirme', 'Birleştirildi', 'Dosyaya Dönüştü', 'Bekletme')),
  kapsam_disi_gerekcesi text, yazisma_dili text NOT NULL DEFAULT 'Türkçe',
  ilk_sorumlu_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik),
  dosya_ref uuid,
  olusturma_zamani timestamptz NOT NULL DEFAULT now(), olusturan_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), guncelleme_zamani timestamptz NOT NULL DEFAULT now(),
  bilgi_sinifi text NOT NULL DEFAULT 'Gizli',
  CHECK (bildirim_alinma_zamani <= kayda_gecis_zamani),
  CHECK (talep_sahibi_telefon IS NOT NULL OR talep_sahibi_eposta IS NOT NULL)
);
CREATE INDEX talep_statu ON talep (statu);
CREATE INDEX talep_yat ON talep (yat_ref);

CREATE TABLE dosya (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dosya_no text NOT NULL UNIQUE,
  talep_ref uuid NOT NULL UNIQUE REFERENCES talep (kimlik),
  acilis_tarihi timestamptz NOT NULL DEFAULT now(),
  yat_ref uuid NOT NULL REFERENCES yat (kimlik),
  bildirim_tarihi timestamptz NOT NULL, olay_tarihi timestamptz, konum text NOT NULL, kisa_teknik_tanim text NOT NULL,
  hizmet_turu text NOT NULL DEFAULT 'Hasar onarımı', ana_teknik_brans text, destek_branslari text[] NOT NULL DEFAULT '{}',
  musteri_turu text NOT NULL CHECK (musteri_turu IN ('Sigorta Şirketi', 'Kurumsal Müşteri', 'Bireysel Müşteri')),
  dosya_niteligi text NOT NULL CHECK (dosya_niteligi IN ('Sigorta bağlantılı', 'Doğrudan hizmet')),
  odeme_sorumlusu text[] NOT NULL DEFAULT '{}',
  oncelik text NOT NULL CHECK (oncelik IN ('Kritik', 'Yüksek', 'Normal', 'Planlı')),
  onerilen_oncelik text, musteri_hedef_tarihi date,
  statu text NOT NULL DEFAULT 'Açılış Kontrolünde' CHECK (statu IN ('Açılış Kontrolünde', 'Aktif', 'Kontrollü Askıda', 'Teknik Kapalı', 'Kapalı')),
  asama text CHECK (asama IN ('Keşif', 'Teklif', 'Onay', 'Uygulama', 'Kontrol', 'Teslim')),
  yat_karada boolean, kapanma_nedeni text, birlestirilen_ana_dosya_ref uuid REFERENCES dosya (kimlik), yeniden_acma_gerekcesi text,
  dosya_sorumlusu_ref text REFERENCES kullanici_hesabi (kimlik), yedek_sorumlu_ref text REFERENCES kullanici_hesabi (kimlik),
  erisim_seviyesi text NOT NULL DEFAULT 'Gizli (dosya ekibi)', acil_gecici_acilis boolean NOT NULL DEFAULT false, eksik_alan_gerekcesi text, tamamlama_hedef_tarihi date,
  zorluk_katsayisi numeric(3,2) NOT NULL DEFAULT 1.00 CHECK (zorluk_katsayisi BETWEEN 0.8 AND 2.0),
  zorluk_revize_edildi boolean NOT NULL DEFAULT false,
  garantili_ekipman boolean, garantili_ekipman_marka text, garanti_bitis date, ek_teminat_durumu text,
  kanuni_sorumluluk_bitis date, vefat_tarihi date, vefat_isareti boolean NOT NULL DEFAULT false, yat_sahibi_itirazi timestamptz,
  ana_dosya_ref uuid REFERENCES dosya (kimlik), yazisma_dili text NOT NULL DEFAULT 'Türkçe',
  risk_kontrol_zamani timestamptz, hasar_ilerleyebilir boolean NOT NULL DEFAULT false,
  ilerleme_yuzdesi numeric(5,2) NOT NULL DEFAULT 0,
  olusturma_zamani timestamptz NOT NULL DEFAULT now(), olusturan_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), guncelleme_zamani timestamptz NOT NULL DEFAULT now(),
  bilgi_sinifi text NOT NULL DEFAULT 'Gizli',
  CHECK (statu <> 'Kapalı' OR kapanma_nedeni IS NOT NULL),
  CHECK (NOT acil_gecici_acilis OR (eksik_alan_gerekcesi IS NOT NULL AND tamamlama_hedef_tarihi IS NOT NULL))
);
ALTER TABLE talep ADD FOREIGN KEY (dosya_ref) REFERENCES dosya (kimlik), ADD FOREIGN KEY (mukerrer_dosya_ref) REFERENCES dosya (kimlik);
CREATE INDEX dosya_statu ON dosya (statu, oncelik);
CREATE INDEX dosya_yat ON dosya (yat_ref);
CREATE INDEX dosya_sorumlu ON dosya (dosya_sorumlusu_ref);

CREATE TABLE dosya_iliskisi (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kaynak_ref uuid NOT NULL REFERENCES dosya (kimlik), hedef_ref uuid NOT NULL REFERENCES dosya (kimlik),
  tur text NOT NULL CHECK (tur IN ('Ana-Alt', 'Aynı Yat', 'Birleştirildi', 'Ayrıldı', 'Yeniden Çevrim')),
  gerekce text, olusturan_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), olusturma_zamani timestamptz NOT NULL DEFAULT now(),
  UNIQUE (kaynak_ref, hedef_ref, tur), CHECK (kaynak_ref <> hedef_ref)
);

-- YG-061: geçmiş durum zinciri silinmez.
CREATE TABLE dosya_statu_gecmisi (
  kimlik bigserial PRIMARY KEY,
  dosya_ref uuid NOT NULL REFERENCES dosya (kimlik),
  onceki_statu text, onceki_asama text, yeni_statu text NOT NULL, yeni_asama text,
  gerekce text NOT NULL, sonraki_sorumlu_rol text, istisna_gerekcesi text,
  olusturma_zamani timestamptz NOT NULL DEFAULT now(), olusturan_ref text REFERENCES kullanici_hesabi (kimlik)
);
CREATE INDEX dosya_statu_gecmisi_dosya ON dosya_statu_gecmisi (dosya_ref, kimlik);

CREATE TABLE dosya_ekibi_atamasi (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dosya_ref uuid NOT NULL REFERENCES dosya (kimlik), kullanici_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik),
  rol text NOT NULL CHECK (rol IN ('Dosya Sorumlusu', 'Yedek Sorumlu', 'Operasyon Yöneticisi', 'Teknik Uzman', 'Sorumlu Teknik Uzman (Koordinatör)', 'Teknik Yönetici', 'Saha Sorumlusu', 'Kalite Kontrolör', 'Tedarik Sorumlusu')),
  atama_zamani timestamptz NOT NULL DEFAULT now(), bitis_zamani timestamptz, devir_notu text,
  olusturan_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), olusturma_zamani timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX dosya_ekibi_dosya ON dosya_ekibi_atamasi (dosya_ref) WHERE bitis_zamani IS NULL;
CREATE INDEX dosya_ekibi_kisi ON dosya_ekibi_atamasi (kullanici_ref) WHERE bitis_zamani IS NULL;
CREATE UNIQUE INDEX dosya_ekibi_tekil ON dosya_ekibi_atamasi (dosya_ref, kullanici_ref, rol) WHERE bitis_zamani IS NULL;

CREATE TABLE beklemede_isareti (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dosya_ref uuid NOT NULL REFERENCES dosya (kimlik), kayit_turu text NOT NULL DEFAULT 'Dosya', kayit_referansi text,
  neden text NOT NULL, sorumlu_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), hedef_tarih date NOT NULL,
  durum_mesaji text, kanit_belge_ref uuid, sayac_durur boolean NOT NULL,
  eskalasyon_zamani timestamptz, gun45_karari text CHECK (gun45_karari IN ('Devam', 'Kontrollü Askıda', 'Kapanış')),
  uzatma_sayisi integer NOT NULL DEFAULT 0, uzatma_gerekcesi text, uzatma_onaylayan_ref text REFERENCES kullanici_hesabi (kimlik),
  kaldirilma_zamani timestamptz,
  olusturma_zamani timestamptz NOT NULL DEFAULT now(), olusturan_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), guncelleme_zamani timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX beklemede_acik ON beklemede_isareti (dosya_ref) WHERE kaldirilma_zamani IS NULL;

CREATE TABLE dosya_tarafi (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dosya_ref uuid NOT NULL REFERENCES dosya (kimlik), taraf_ref uuid REFERENCES taraf (kimlik),
  taraf_rolu text NOT NULL, kurulus_unvani text, kisi_adi_soyadi text NOT NULL, gorevi text, sifat text, telefon text, eposta text,
  iletisim_dogrulandi boolean NOT NULL DEFAULT false, kimlik_dogrulama_durumu text NOT NULL DEFAULT 'Bekliyor',
  kullanici_ref text REFERENCES kullanici_hesabi (kimlik), talep_sahibi_mi boolean NOT NULL DEFAULT false,
  aktif boolean NOT NULL DEFAULT true,
  olusturma_zamani timestamptz NOT NULL DEFAULT now(), olusturan_ref text REFERENCES kullanici_hesabi (kimlik), guncelleme_zamani timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX dosya_tarafi_dosya ON dosya_tarafi (dosya_ref);
CREATE INDEX dosya_tarafi_kisi ON dosya_tarafi (kullanici_ref);

CREATE TABLE yetki_kaydi (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dosya_ref uuid NOT NULL REFERENCES dosya (kimlik), dosya_tarafi_ref uuid NOT NULL REFERENCES dosya_tarafi (kimlik),
  yetki_dayanagi_turu text NOT NULL, yetki_belgesi_ref uuid, belge_duzenleyen text NOT NULL, belge_tarihi date NOT NULL,
  gecerlilik_baslangici date NOT NULL, gecerlilik_bitisi date, yetkili_islemler text[] NOT NULL CHECK (cardinality(yetkili_islemler) > 0),
  parasal_sinir numeric(14,2), dogrulayan_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), dogrulama_zamani timestamptz NOT NULL DEFAULT now(), dogrulama_kaniti text NOT NULL,
  ikinci_kanal_teyidi boolean, yetki_durumu text NOT NULL DEFAULT 'Geçerli' CHECK (yetki_durumu IN ('Doğrulama Bekliyor', 'Geçerli', 'Askıya Alındı', 'Geri Alındı', 'Süresi Doldu')),
  gecici_acil_yetki boolean NOT NULL DEFAULT false, surum integer NOT NULL DEFAULT 1,
  olusturma_zamani timestamptz NOT NULL DEFAULT now(), olusturan_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), guncelleme_zamani timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE dosya_sigorta_kaydi (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dosya_ref uuid NOT NULL UNIQUE REFERENCES dosya (kimlik), sigorta_taraf_ref uuid REFERENCES dosya_tarafi (kimlik),
  sigortaci_adi text, police_no text, sigorta_hasar_dosya_no text, dosya_yetkilisi text, onay_siniri numeric(14,2), taniklik_talebi boolean NOT NULL DEFAULT false,
  istenen_hizmet text, cerceve_sozlesme_yok boolean NOT NULL DEFAULT false,
  olusturma_zamani timestamptz NOT NULL DEFAULT now(), olusturan_ref text REFERENCES kullanici_hesabi (kimlik), guncelleme_zamani timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE dosya_acilis_karari (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  talep_ref uuid NOT NULL REFERENCES talep (kimlik), dosya_ref uuid REFERENCES dosya (kimlik),
  acilis_ozeti text NOT NULL,
  karar text NOT NULL CHECK (karar IN ('Kabul', 'Koşullu Açılış', 'Bekletme', 'Yönlendirme', 'Ret')),
  kosullar_yasaklar text, yeniden_degerlendirme date, gerekce text,
  karar_veren_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), karar_zamani timestamptz NOT NULL DEFAULT now(),
  CHECK (karar <> 'Koşullu Açılış' OR kosullar_yasaklar IS NOT NULL),
  CHECK (karar <> 'Bekletme' OR yeniden_degerlendirme IS NOT NULL),
  CHECK (karar NOT IN ('Yönlendirme', 'Ret') OR gerekce IS NOT NULL)
);

-- YG-059: açık konu sahipsiz açılamaz. Durumlar YG-058.
CREATE TABLE acik_konu (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  konu_no text NOT NULL UNIQUE, dosya_ref uuid NOT NULL REFERENCES dosya (kimlik),
  baslik text NOT NULL CHECK (length(trim(baslik)) > 0), aciklama text, kaynak text,
  sahip_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), hedef_tarih date NOT NULL,
  statu text NOT NULL DEFAULT 'Açık' CHECK (statu IN ('Açık', 'İşlemde', 'Doğrulamada', 'Kapalı', 'Geçersiz')),
  kapanis_kaniti text, dogrulayan_ref text REFERENCES kullanici_hesabi (kimlik), kapanis_zamani timestamptz,
  olusturma_zamani timestamptz NOT NULL DEFAULT now(), olusturan_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), guncelleme_zamani timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX acik_konu_dosya ON acik_konu (dosya_ref);

-- YG-040…YG-044, YG-1607: sayaçlar. Duraklama süresi sayaç durduran Beklemede işaretlerinden hesaplanır.
CREATE TABLE dosya_sure (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dosya_ref uuid REFERENCES dosya (kimlik), talep_ref uuid REFERENCES talep (kimlik),
  tur text NOT NULL CHECK (tur IN ('İlk Yanıt', 'Teknik Uzman Ataması', 'Randevu İletişimi', 'Keşif', 'Teklif', 'Sahaya Ulaşma')),
  baslangic timestamptz NOT NULL, bitis timestamptz NOT NULL, kaydirma_notu text, tamamlanma timestamptz,
  olusturma_zamani timestamptz NOT NULL DEFAULT now(),
  CHECK (dosya_ref IS NOT NULL OR talep_ref IS NOT NULL)
);
CREATE INDEX dosya_sure_acik ON dosya_sure (bitis) WHERE tamamlanma IS NULL;
CREATE UNIQUE INDEX dosya_sure_tekil_talep ON dosya_sure (talep_ref, tur);
CREATE UNIQUE INDEX dosya_sure_tekil_dosya ON dosya_sure (dosya_ref, tur);

-- YG-036: öncelik düşürme talebi; görüş ayrılığında bir üst kademeye geçer, karara kadar mevcut öncelik kalır.
CREATE TABLE oncelik_talebi (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dosya_ref uuid NOT NULL REFERENCES dosya (kimlik), eski_oncelik text NOT NULL, yeni_oncelik text NOT NULL, gerekce text NOT NULL,
  kademe integer NOT NULL DEFAULT 0, durum text NOT NULL DEFAULT 'Bekliyor' CHECK (durum IN ('Bekliyor', 'Onaylandı', 'Reddedildi')),
  talep_eden_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), olusturma_zamani timestamptz NOT NULL DEFAULT now(), karar_zamani timestamptz
);
CREATE UNIQUE INDEX oncelik_talebi_acik ON oncelik_talebi (dosya_ref) WHERE durum = 'Bekliyor';
GRANT SELECT, INSERT, UPDATE ON oncelik_talebi TO yatonet_uygulama;

CREATE TABLE resmi_tatil (tarih date PRIMARY KEY, ad text NOT NULL);

GRANT SELECT, INSERT, UPDATE ON numara_sayaci, yat, taraf, talep, dosya, dosya_ekibi_atamasi, beklemede_isareti, dosya_tarafi, yetki_kaydi, dosya_sigorta_kaydi, acik_konu, dosya_sure TO yatonet_uygulama;
GRANT SELECT, INSERT ON dosya_iliskisi, dosya_acilis_karari TO yatonet_uygulama;
GRANT SELECT, INSERT, UPDATE ON yat_marka_model TO yatonet_uygulama;
GRANT SELECT, INSERT ON dosya_statu_gecmisi TO yatonet_uygulama;
GRANT USAGE ON SEQUENCE dosya_statu_gecmisi_kimlik_seq TO yatonet_uygulama;
GRANT SELECT ON resmi_tatil TO yatonet_uygulama;
