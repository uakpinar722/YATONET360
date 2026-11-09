-- YG-367, ANV-1: aday firma havuzu ve bağlama noktaları ana veriden aktarılır.
ALTER TABLE kurulus ADD COLUMN IF NOT EXISTS ana_veri_no integer UNIQUE, ADD COLUMN IF NOT EXISTS adres text, ADD COLUMN IF NOT EXISTS web text, ADD COLUMN IF NOT EXISTS mukerrer_grubu text, ADD COLUMN IF NOT EXISTS mukerrer_karari text CHECK (mukerrer_karari IN ('Karar bekliyor', 'Ayrı Kayıt', 'Birleştirildi')), ADD COLUMN IF NOT EXISTS ana_kayit_ref uuid REFERENCES kurulus (kimlik);
CREATE TABLE baglama_noktasi (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), nokta_no integer NOT NULL UNIQUE, tur text NOT NULL, il text, ilce text, belde text, ad text NOT NULL CHECK (length(trim(ad)) > 0), bolge text, hizmet_kumesi text, teyit_durumu text, enlem numeric(9,6), boylam numeric(9,6),
  mukerrer_grubu text, mukerrer_karari text CHECK (mukerrer_karari IN ('Karar bekliyor', 'Ayrı Kayıt', 'Birleştirildi')), ana_nokta_ref uuid REFERENCES baglama_noktasi (kimlik), tesis_ref uuid REFERENCES firma_tesisi (kimlik), olusturma_zamani timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX baglama_noktasi_il ON baglama_noktasi (il);
GRANT SELECT, INSERT, UPDATE ON baglama_noktasi TO yatonet_uygulama;
