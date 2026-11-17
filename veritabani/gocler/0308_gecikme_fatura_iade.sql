-- YG-420: firmanın iş emri gecikme bildirimi; firma faturasının gerekçeyle iadesi.
CREATE TABLE firma_gecikme_bildirimi (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), is_emri_ref uuid NOT NULL REFERENCES is_emri (kimlik), kurulus_ref uuid NOT NULL REFERENCES kurulus (kimlik),
  neden text NOT NULL CHECK (length(trim(neden)) > 0), yeni_tarih date NOT NULL, giren_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), zaman timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX firma_gecikme_is ON firma_gecikme_bildirimi (is_emri_ref);
GRANT SELECT, INSERT ON firma_gecikme_bildirimi TO yatonet_uygulama;
ALTER TABLE hakedis ADD COLUMN fatura_iade_gerekcesi text, ADD COLUMN fatura_iade_zamani timestamptz, ADD COLUMN fatura_iade_eden_ref text REFERENCES kullanici_hesabi (kimlik);
