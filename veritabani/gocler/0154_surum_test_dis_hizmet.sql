-- YG-1125, YG-1134: yayın seti (sürüm, bileşenler, paket özeti; üretim paketi test edilen paketle aynı olmalı).
CREATE TABLE yayin_seti (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), surum text NOT NULL CHECK (length(trim(surum)) > 0), ortam text NOT NULL CHECK (ortam IN ('Test', 'Üretim')),
  paket_ozeti text NOT NULL CHECK (paket_ozeti ~ '^[0-9a-f]{64}$'), bilesenler jsonb NOT NULL, degisiklikler uuid[] NOT NULL DEFAULT '{}', test_edilen_ref uuid REFERENCES yayin_seti (kimlik),
  durum text NOT NULL DEFAULT 'Hazırlandı' CHECK (durum IN ('Hazırlandı', 'Test Edildi', 'Onayda', 'Üretimde', 'Geri Alındı')), hazirlayan_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), onaylayan_ref text REFERENCES kullanici_hesabi (kimlik),
  zaman timestamptz NOT NULL DEFAULT now(), uretim_zamani timestamptz, UNIQUE (surum, ortam)
);
-- YG-1138: risk temelli test senaryosu; YG-1139: test hatası ve yeniden test.
CREATE TABLE test_senaryosu (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), kod text NOT NULL UNIQUE, yayin_ref uuid NOT NULL REFERENCES yayin_seti (kimlik), gereksinim text NOT NULL, risk text NOT NULL CHECK (risk IN ('Yüksek', 'Orta', 'Düşük')),
  tur text NOT NULL CHECK (tur IN ('Mutlu Yol', 'Ret', 'İade', 'İptal', 'Yeniden Açma', 'Yetkisiz Kullanıcı', 'Tekrar Çağrı', 'Kesinti', 'Geri Alma')),
  on_kosul text NOT NULL, veri text NOT NULL, rol text NOT NULL, adimlar text NOT NULL, beklenen text NOT NULL, olusturan_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), zaman timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE test_kosusu (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), senaryo_ref uuid NOT NULL REFERENCES test_senaryosu (kimlik), sonuc text NOT NULL CHECK (sonuc IN ('Geçti', 'Kaldı')), kanit text NOT NULL CHECK (length(trim(kanit)) > 0),
  kosan_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), zaman timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE test_hatasi (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), hata_no text NOT NULL UNIQUE, senaryo_ref uuid NOT NULL REFERENCES test_senaryosu (kimlik), onem text NOT NULL CHECK (onem IN ('Kritik', 'Yüksek', 'Orta', 'Düşük')),
  tekrar text NOT NULL CHECK (tekrar IN ('Her Seferinde', 'Ara Sıra', 'Bir Kez')), gereksinim text NOT NULL, kanit text NOT NULL, sorumlu_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), hedef_surum text NOT NULL,
  durum text NOT NULL DEFAULT 'Açık' CHECK (durum IN ('Açık', 'Düzeltildi', 'Kapalı')), duzeltme_notu text, duzeltme_zamani timestamptz, kapanis_kosu_ref uuid REFERENCES test_kosusu (kimlik),
  acan_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), zaman timestamptz NOT NULL DEFAULT now()
);
-- YG-1137: üretim sonrası izleme; beklenmeyen davranış problem kaydına bağlanır.
ALTER TABLE problem_kaydi DROP CONSTRAINT IF EXISTS problem_kaydi_kaynak_check;
ALTER TABLE problem_kaydi ADD CONSTRAINT problem_kaydi_kaynak_check CHECK (kaynak IN ('Tekrarlayan Olay', 'Yüksek Etkili Olay', 'Denetim Bulgusu', 'Eğilim', 'Üretim Sonrası İzleme'));
CREATE TABLE uretim_izleme (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), yayin_ref uuid NOT NULL REFERENCES yayin_seti (kimlik), alan text NOT NULL CHECK (alan IN ('İş Akışı', 'Yetki', 'Rapor', 'Bildirim', 'Entegrasyon')),
  sonuc text NOT NULL CHECK (sonuc IN ('Beklendiği Gibi', 'Beklenmeyen')), aciklama text NOT NULL, problem_ref uuid REFERENCES problem_kaydi (kimlik), kaydeden_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), zaman timestamptz NOT NULL DEFAULT now(),
  CHECK (sonuc = 'Beklendiği Gibi' OR problem_ref IS NOT NULL)
);
-- YG-1304: isimli hizmet hesabı, dar yetki, güvenli kimlik doğrulama, onaylı destek yöntemi, alt sağlayıcılar; hizmet seviyesi iş etkisiyle.
CREATE TABLE hizmet_hesabi (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), hesap_adi text NOT NULL UNIQUE, saglayici text NOT NULL, kisi text NOT NULL, kapsam text[] NOT NULL CHECK (cardinality(kapsam) > 0), cok_faktorlu boolean NOT NULL CHECK (cok_faktorlu),
  destek_yontemi text NOT NULL CHECK (destek_yontemi IN ('Onaylı Uzak Erişim Aracı', 'LGM Gözetiminde Ekran Paylaşımı', 'Yerinde')), alt_saglayicilar text[] NOT NULL DEFAULT '{}', sozlesme_bitis date NOT NULL,
  durum text NOT NULL DEFAULT 'Onayda' CHECK (durum IN ('Onayda', 'Aktif', 'Çıkışta', 'Kapalı')), kaydeden_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), onaylayan_ref text REFERENCES kullanici_hesabi (kimlik), zaman timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE hizmet_seviyesi_olcumu (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), hesap_ref uuid NOT NULL REFERENCES hizmet_hesabi (kimlik), baslangic timestamptz NOT NULL, bitis timestamptz NOT NULL CHECK (bitis > baslangic),
  etkilenen_is text NOT NULL, etkilenen_kullanici integer NOT NULL CHECK (etkilenen_kullanici >= 0), etkilenen_dosya integer NOT NULL CHECK (etkilenen_dosya >= 0), kaydeden_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), zaman timestamptz NOT NULL DEFAULT now()
);
-- YG-1002: dış uzman/destek erişimi süreli ve olay bazlı; üretim verisi yalnız gerekçeyle.
CREATE TABLE dis_erisim_izni (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), hesap_ref uuid NOT NULL REFERENCES hizmet_hesabi (kimlik), olay_turu text NOT NULL CHECK (olay_turu IN ('Problem', 'Olay', 'Değişiklik')), olay_ref uuid NOT NULL, gerekce text NOT NULL,
  veri text NOT NULL CHECK (veri IN ('Test Verisi', 'Maskeli Veri', 'Üretim Verisi')), uretim_gerekcesi text, baslangic timestamptz NOT NULL, bitis timestamptz NOT NULL CHECK (bitis > baslangic),
  durum text NOT NULL DEFAULT 'Onayda' CHECK (durum IN ('Onayda', 'Aktif', 'Bitti', 'Reddedildi', 'İptal')), talep_eden_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), onaylayan_ref text REFERENCES kullanici_hesabi (kimlik), zaman timestamptz NOT NULL DEFAULT now(),
  CHECK (veri <> 'Üretim Verisi' OR length(trim(coalesce(uretim_gerekcesi, ''))) > 0)
);
-- YG-1305: dış hizmet çıkışı kontrol listesi.
CREATE TABLE hizmet_cikisi (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), hesap_ref uuid NOT NULL UNIQUE REFERENCES hizmet_hesabi (kimlik), maddeler jsonb NOT NULL DEFAULT '{}', durum text NOT NULL DEFAULT 'Açık' CHECK (durum IN ('Açık', 'Tamamlandı')),
  baslatan_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), tamamlayan_ref text REFERENCES kullanici_hesabi (kimlik), zaman timestamptz NOT NULL DEFAULT now(), kapanis_zamani timestamptz
);
GRANT SELECT, INSERT, UPDATE ON yayin_seti, test_senaryosu, test_kosusu, test_hatasi, uretim_izleme, hizmet_hesabi, hizmet_seviyesi_olcumu, dis_erisim_izni, hizmet_cikisi TO yatonet_uygulama;
