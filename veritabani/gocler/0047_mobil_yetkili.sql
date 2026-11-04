-- İP-9: mobil cihaz belirteci, çevrimdışı eşitleme, saha konumu, hesap kapatma talebi, Yat Yetkilisi kaydı.
CREATE TABLE mobil_cihaz (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), kullanici_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), oturum_ref uuid, platform text NOT NULL CHECK (platform IN ('iOS', 'Android')), bildirim_belirteci text NOT NULL UNIQUE, durum text NOT NULL DEFAULT 'Aktif' CHECK (durum IN ('Aktif', 'İptal', 'Kayıp')), iptal_nedeni text, iptal_zamani timestamptz, olusturma_zamani timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX mobil_cihaz_kisi ON mobil_cihaz (kullanici_ref) WHERE durum = 'Aktif';
CREATE TABLE mobil_esitleme (
  istemci_kimlik uuid PRIMARY KEY, kullanici_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), yol text NOT NULL, govde jsonb NOT NULL, temel_zaman timestamptz, durum text NOT NULL CHECK (durum IN ('Uygulandı', 'Çakışma', 'Reddedildi')), yanit_kodu integer, yanit text, zaman timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE mobil_izin (kullanici_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), tur text NOT NULL CHECK (tur IN ('Konum', 'Kamera')), metin_surumu text NOT NULL, zaman timestamptz NOT NULL DEFAULT now(), geri_alma_zamani timestamptz, PRIMARY KEY (kullanici_ref, tur));
CREATE TABLE saha_konum_kaydi (kimlik bigserial PRIMARY KEY, kullanici_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), dosya_ref uuid NOT NULL REFERENCES dosya (kimlik), enlem numeric(9,6) NOT NULL, boylam numeric(9,6) NOT NULL, zaman timestamptz NOT NULL DEFAULT now());
CREATE INDEX saha_konum_zaman ON saha_konum_kaydi (zaman);
CREATE TABLE hesap_kapatma_talebi (kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), kullanici_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), acik_dosya_sayisi integer NOT NULL DEFAULT 0, zaman timestamptz NOT NULL DEFAULT now());
CREATE TABLE yat_yetkilisi_kaydi (
  kullanici_ref text PRIMARY KEY REFERENCES kullanici_hesabi (kimlik), rol text NOT NULL CHECK (rol IN ('Yatın Kaptanı', 'Yat Sahibinin Yetkili Temsilcisi', 'Yat Yönetim Şirketi / İşletmeci', 'Diğer')), sahip_ad text NOT NULL, sahip_telefon text NOT NULL, sahip_eposta text, sahip_bilgilendirme_zamani timestamptz, belge_ref uuid REFERENCES belge (kimlik), belge_durumu text NOT NULL DEFAULT 'Bekleniyor' CHECK (belge_durumu IN ('Bekleniyor', 'Kontrolde', 'Geçerli')), islem_turleri text[] NOT NULL DEFAULT '{}', ust_limit_eur numeric(14,2), bitis_tarihi date, odeme_yetkisi boolean NOT NULL DEFAULT false, bilgi_paylasim_izni boolean NOT NULL DEFAULT false, dogrulayan_ref text REFERENCES kullanici_hesabi (kimlik), olusturma_zamani timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON mobil_cihaz, mobil_esitleme, mobil_izin, hesap_kapatma_talebi, yat_yetkilisi_kaydi TO yatonet_uygulama;
GRANT SELECT, INSERT, DELETE ON saha_konum_kaydi TO yatonet_uygulama;
GRANT USAGE ON SEQUENCE saha_konum_kaydi_kimlik_seq TO yatonet_uygulama;
