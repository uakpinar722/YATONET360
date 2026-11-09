-- YG-1258, YG-1264, YG-1265 bölge ve telefon; YG-441, YG-442 sigorta kurum kartı; YG-1209 pazarlama sorusu.
CREATE TABLE bolge_eslesme (il text NOT NULL, ilce text NOT NULL, bolge text NOT NULL, hizmet_kumesi text NOT NULL, saha_merkezi text, kalici_saha boolean, destek text, PRIMARY KEY (il, ilce));
CREATE TABLE il_varsayilan (il text PRIMARY KEY, bolge text NOT NULL, hizmet_kumesi text NOT NULL);
ALTER TABLE kurulus ADD COLUMN bolge text, ADD COLUMN hizmet_kumesi text, ADD COLUMN saha_merkezi text, ADD COLUMN telefon_kontrol boolean NOT NULL DEFAULT false;
CREATE TABLE sigorta_kurum_karti (sigortaci_adi text PRIMARY KEY, kanal text NOT NULL CHECK (kanal IN ('Kendi Portalı', 'E-posta Şablonu', 'YATONET 360 Portalı')), portal_adresi text, paket_bicimi text, guncelleyen_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), zaman timestamptz NOT NULL DEFAULT now());
CREATE TABLE sigorta_portal_yukleme (teklif_ref uuid PRIMARY KEY REFERENCES fiyat_teklifi (kimlik), referans text NOT NULL, yukleyen_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), zaman timestamptz NOT NULL DEFAULT now());
CREATE TABLE pazarlama_sorusu (kullanici_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), adim text NOT NULL CHECK (adim IN ('Talep', 'Teslim')), cevap text NOT NULL CHECK (cevap IN ('Onay', 'Şimdilik Geç')), zaman timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (kullanici_ref, adim));
GRANT SELECT ON bolge_eslesme, il_varsayilan TO yatonet_uygulama;
GRANT SELECT, INSERT, UPDATE ON sigorta_kurum_karti TO yatonet_uygulama;
GRANT SELECT, INSERT ON sigorta_portal_yukleme, pazarlama_sorusu TO yatonet_uygulama;
