-- YG-1422: yurt dışı garanti talebi. YG-412: menfaat talebi bildirimi. YG-1622: fiş türü ve aslın teslimi.
ALTER TABLE garanti_sikayet ADD COLUMN IF NOT EXISTS yurt_disi boolean NOT NULL DEFAULT false, ADD COLUMN IF NOT EXISTS yerinde_mudahale boolean NOT NULL DEFAULT false;
CREATE TABLE menfaat_bildirimi (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), is_emri_ref uuid NOT NULL REFERENCES is_emri (kimlik), dosya_ref uuid NOT NULL REFERENCES dosya (kimlik), kurulus_ref uuid NOT NULL REFERENCES kurulus (kimlik), kaynak text NOT NULL CHECK (kaynak IN ('Kaptan', 'Mürettebat')), aciklama text NOT NULL CHECK (length(trim(aciklama)) > 0), giren_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), olusturma_zamani timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON menfaat_bildirimi TO yatonet_uygulama;
ALTER TABLE personel_masraf_fisi ADD COLUMN IF NOT EXISTS belge_turu text NOT NULL DEFAULT 'Kağıt Fiş' CHECK (belge_turu IN ('Kağıt Fiş', 'e-Fatura', 'e-Arşiv')), ADD COLUMN IF NOT EXISTS asil_teslim_zamani timestamptz, ADD COLUMN IF NOT EXISTS asil_teslim_alan_ref text REFERENCES kullanici_hesabi (kimlik);
