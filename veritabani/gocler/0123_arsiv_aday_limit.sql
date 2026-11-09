-- YG-1235, YG-1236 arşiv devri; YG-1229 aday teması; YG-343 branşa göre poliçe limiti.
ALTER TABLE dosya ADD COLUMN arsiv_zamani timestamptz;
CREATE TABLE dosya_arsiv_devri (dosya_ref uuid PRIMARY KEY REFERENCES dosya (kimlik), kapanma_nedeni text, bilgi_sinifi text NOT NULL, saklama_grubu text NOT NULL, saklama_bitis date NOT NULL, imha_donemi text NOT NULL, garanti_bitis date, devreden_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), zaman timestamptz NOT NULL DEFAULT now());
ALTER TABLE kurulus ADD COLUMN son_temas_tarihi date, ADD COLUMN aydinlatma_zamani timestamptz;
CREATE TABLE firma_police_brans_limit (brans text PRIMARY KEY, limit_eur numeric(14,2) NOT NULL CHECK (limit_eur > 0), giren_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), zaman timestamptz NOT NULL DEFAULT now());
GRANT SELECT, INSERT ON dosya_arsiv_devri TO yatonet_uygulama;
GRANT SELECT, INSERT, UPDATE ON firma_police_brans_limit TO yatonet_uygulama;
