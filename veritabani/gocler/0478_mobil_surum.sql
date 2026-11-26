-- YG-490: mobil sürüm kontrolü; en düşük sürümün altındaki uygulama kullanılamaz (zorunlu güncelleme), güncel sürüm varsa uyarı verilir. Değerleri Sistem Yöneticisi girer.
CREATE TABLE mobil_surum (
  platform text PRIMARY KEY CHECK (platform IN ('android', 'ios')),
  en_az text NOT NULL CHECK (en_az ~ '^\d+\.\d+\.\d+$'), guncel text NOT NULL CHECK (guncel ~ '^\d+\.\d+\.\d+$'),
  magaza_baglantisi text, giren_ref text REFERENCES kullanici_hesabi (kimlik), guncelleme_zamani timestamptz NOT NULL DEFAULT now()
);
INSERT INTO mobil_surum (platform, en_az, guncel) VALUES ('android', '0.1.0', '0.1.0'), ('ios', '0.1.0', '0.1.0');
GRANT SELECT, UPDATE ON mobil_surum TO yatonet_uygulama;
