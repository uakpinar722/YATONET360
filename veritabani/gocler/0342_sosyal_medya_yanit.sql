-- YG-1466, YG-731: dosya eşleşmesi ve sözcünün onaylı şablonla yanıtı (FR-KLT-017; Genel, Dosyalı, Olumlu; TR/EN).
ALTER TABLE sosyal_medya_kaydi ADD COLUMN dosya_ref uuid REFERENCES dosya (kimlik), ADD COLUMN yanit_varyant text CHECK (yanit_varyant IN ('Genel', 'Dosyalı', 'Olumlu')), ADD COLUMN yanit_dil text CHECK (yanit_dil IN ('tr', 'en')),
  ADD COLUMN yanit_metni text, ADD COLUMN yanitlayan_ref text REFERENCES kullanici_hesabi (kimlik), ADD COLUMN yanit_zamani timestamptz;
