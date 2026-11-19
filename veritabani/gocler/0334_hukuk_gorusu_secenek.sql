-- YG-1697 (A51-S1): hukuki görüş Uygun / Koşullu / Uygun Değil seçenekleriyle ve notla verilir (eski "Uygun Görülmedi" kayıtları korunur).
ALTER TABLE firma_hukuk_gorusu DROP CONSTRAINT IF EXISTS firma_hukuk_gorusu_gorus_check;
ALTER TABLE firma_hukuk_gorusu ADD CONSTRAINT firma_hukuk_gorusu_gorus_check CHECK (gorus IN ('Uygun', 'Koşullu', 'Uygun Değil', 'Uygun Görülmedi'));
ALTER TABLE firma_hukuk_gorusu ADD COLUMN gorus_notu text;
