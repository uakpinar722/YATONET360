-- YG-271 (V-1120): acil çağrının katmanı (Bölge, Komşu, Mobil Ekip, Ulusal) ve bölge dışı geçişte sistemin yazdığı gerekçe.
ALTER TABLE acil_gorev_cagrisi ADD COLUMN katman text CHECK (katman IN ('Bölge', 'Komşu', 'Mobil Ekip', 'Ulusal')), ADD COLUMN genisleme_gerekcesi text;
