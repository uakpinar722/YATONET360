-- Tedarik siparişinin yazışma dili; İngilizcede Türkçe sürüm de üretilir.
ALTER TABLE tedarik_siparisi ADD COLUMN dil text NOT NULL DEFAULT 'Türkçe' CHECK (dil IN ('Türkçe', 'İngilizce'));
