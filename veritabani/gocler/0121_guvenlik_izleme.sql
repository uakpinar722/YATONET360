-- YG-1188, YG-1190–1194: güvenlik izleme, tedbir, acil erişim, destek erişim kaydı.
CREATE TABLE guvenlik_kural (kod text PRIMARY KEY, ad text NOT NULL, esik integer NOT NULL CHECK (esik >= 1), pencere_dk integer NOT NULL CHECK (pencere_dk > 0), onem text NOT NULL CHECK (onem IN ('Düşük', 'Orta', 'Yüksek', 'Kritik')), beklenen_eylem text NOT NULL, istisna_bitis timestamptz, istisna_gerekce text);
CREATE TABLE guvenlik_alarmi (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), alarm_no text NOT NULL UNIQUE, kural_kod text NOT NULL REFERENCES guvenlik_kural (kod), onem text NOT NULL, etkilenen text NOT NULL, olay_sayisi integer NOT NULL, beklenen_eylem text NOT NULL, anahtar text NOT NULL UNIQUE, durum text NOT NULL DEFAULT 'Açık' CHECK (durum IN ('Açık', 'Kabul', 'İncelemede', 'Sınırlandı', 'Kapalı')), olusturma_zamani timestamptz NOT NULL DEFAULT now(), kabul_zamani timestamptz, inceleme_zamani timestamptz, sinirlama_zamani timestamptz, kapanis_zamani timestamptz, kapanis_notu text
);
CREATE TABLE guvenlik_tedbiri (kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), alarm_ref uuid NOT NULL REFERENCES guvenlik_alarmi (kimlik), tur text NOT NULL, hedef text, gerekce text NOT NULL, karar_veren_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), uygulandi boolean NOT NULL, zaman timestamptz NOT NULL DEFAULT now());
CREATE TABLE kir_cam_erisim (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), kullanan_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), kapsam text NOT NULL, gerekce text NOT NULL, kisisel_veri boolean NOT NULL DEFAULT false, durum text NOT NULL DEFAULT 'Talep' CHECK (durum IN ('Talep', 'Aktif', 'Kapatıldı')), onaylayan_ref text REFERENCES kullanici_hesabi (kimlik), onay_zamani timestamptz, veri_sahibi_onayi text, sir_yenilendi boolean NOT NULL DEFAULT false, inceleyen_ref text REFERENCES kullanici_hesabi (kimlik), inceleme_notu text, kapanis_zamani timestamptz, olusturma_zamani timestamptz NOT NULL DEFAULT now(),
  CHECK (onaylayan_ref IS NULL OR onaylayan_ref <> kullanan_ref), CHECK (inceleyen_ref IS NULL OR (inceleyen_ref <> kullanan_ref AND inceleyen_ref <> onaylayan_ref))
);
CREATE TABLE destek_erisim_kaydi (kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), tur text NOT NULL CHECK (tur IN ('Ekran Paylaşımı', 'Dosya İndirme', 'Uzaktan Yönetim')), kullanici_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), kapsam text NOT NULL, destek_no text, yapan_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), zaman timestamptz NOT NULL DEFAULT now());
GRANT SELECT, UPDATE ON guvenlik_kural TO yatonet_uygulama;
GRANT SELECT, INSERT, UPDATE ON guvenlik_alarmi, kir_cam_erisim TO yatonet_uygulama;
GRANT SELECT, INSERT ON guvenlik_tedbiri, destek_erisim_kaydi TO yatonet_uygulama;
INSERT INTO guvenlik_kural (kod, ad, esik, pencere_dk, onem, beklenen_eylem) VALUES ('BASARISIZ_GIRIS','Olağan Dışı Giriş Denemesi',10,15,'Orta','Kaynak adresi ve hesabı inceleyiniz.');
INSERT INTO guvenlik_kural (kod, ad, esik, pencere_dk, onem, beklenen_eylem) VALUES ('KAYITSIZ_CIHAZ','Kayıtsız Cihazdan Giriş',1,60,'Orta','Kullanıcıyla cihazı teyit ediniz.');
INSERT INTO guvenlik_kural (kod, ad, esik, pencere_dk, onem, beklenen_eylem) VALUES ('YETKISIZ_ERISIM','Yetkisiz Erişim Denemesi',5,15,'Yüksek','Hesabın etkinliğini inceleyiniz.');
INSERT INTO guvenlik_kural (kod, ad, esik, pencere_dk, onem, beklenen_eylem) VALUES ('TOPLU_INDIRME','Toplu Belge İndirme',50,60,'Yüksek','İndirmenin iş gerekçesini doğrulayınız.');
INSERT INTO guvenlik_kural (kod, ad, esik, pencere_dk, onem, beklenen_eylem) VALUES ('YETKI_ARTISI','Yetki Artışı',1,60,'Orta','Atamanın onayını doğrulayınız.');
INSERT INTO guvenlik_kural (kod, ad, esik, pencere_dk, onem, beklenen_eylem) VALUES ('YAPILANDIRMA','Yapılandırma Değişikliği',1,60,'Orta','Değişikliğin onayını doğrulayınız.');
INSERT INTO guvenlik_kural (kod, ad, esik, pencere_dk, onem, beklenen_eylem) VALUES ('ENTEGRASYON_TEKRAR','Entegrasyon Hata Tekrarı',10,60,'Orta','Dış servisi ve bekleyen gönderimleri kontrol ediniz.');
