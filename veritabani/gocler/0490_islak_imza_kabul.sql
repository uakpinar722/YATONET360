-- YG-224, K-139 (V-1118): sistem erişimi olmayan firma veya tedarikçinin ıslak imzalı kabul belgesi ve gerekçesi.
ALTER TABLE is_emri ADD COLUMN islak_imza_belge_ref uuid REFERENCES belge (kimlik), ADD COLUMN islak_imza_gerekcesi text;
ALTER TABLE tedarik_siparisi ADD COLUMN islak_imza_belge_ref uuid REFERENCES belge (kimlik), ADD COLUMN islak_imza_gerekcesi text;
