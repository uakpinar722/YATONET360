-- YG-082, YG-870 (KS-1, CEO 17.11.2026): garanti dosya bazında açık kararla oluşur; varsayılan garanti yoktur.
ALTER TABLE dosya ADD COLUMN garanti_tanimli boolean, ADD COLUMN garanti_suresi_ay integer CHECK (garanti_suresi_ay BETWEEN 1 AND 120), ADD COLUMN garanti_kapsami text,
  ADD COLUMN garanti_karar_veren_ref text REFERENCES kullanici_hesabi (kimlik), ADD COLUMN garanti_karar_zamani timestamptz;
ALTER TABLE dosya ADD CONSTRAINT dosya_garanti_check CHECK (garanti_tanimli IS NOT TRUE OR (garanti_suresi_ay IS NOT NULL AND length(trim(coalesce(garanti_kapsami, ''))) > 0));
