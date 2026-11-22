-- YG-1420: kök neden analizi garanti olayına da bağlanır; kısa seviyede katkı, bariyer ve tekrar olasılığı boş kalabilir.
ALTER TABLE kok_neden_analizi ALTER COLUMN uygunsuzluk_ref DROP NOT NULL, ALTER COLUMN katki_faktorleri DROP NOT NULL, ALTER COLUMN bariyer_analizi DROP NOT NULL, ALTER COLUMN tekrar_olasiligi DROP NOT NULL,
  ADD COLUMN garanti_ref uuid REFERENCES garanti_sikayet (kimlik), ADD COLUMN seviye text NOT NULL DEFAULT 'Ayrıntılı' CHECK (seviye IN ('Kısa', 'Ayrıntılı')),
  ADD CONSTRAINT kok_neden_bagi CHECK (uygunsuzluk_ref IS NOT NULL OR garanti_ref IS NOT NULL),
  ADD CONSTRAINT kok_neden_ayrintili CHECK (seviye = 'Kısa' OR (katki_faktorleri IS NOT NULL AND bariyer_analizi IS NOT NULL AND tekrar_olasiligi IS NOT NULL));
ALTER TABLE garanti_sikayet ADD COLUMN kok_neden_ref uuid REFERENCES kok_neden_analizi (kimlik);
