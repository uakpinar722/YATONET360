-- YG-964, YG-965: zorluk katsayısı kaydı. Kısmi ölçülen göstergenin kapsam notu.
ALTER TABLE personel_karne_satir ADD COLUMN kapsam text;
CREATE TABLE dosya_zorluk_kaydi (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), dosya_ref uuid NOT NULL REFERENCES dosya (kimlik), katsayi numeric(3,2) NOT NULL CHECK (katsayi BETWEEN 0.8 AND 2.0), olcutler jsonb NOT NULL, gerekce text, giren_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), zaman timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON dosya_zorluk_kaydi TO yatonet_uygulama;
