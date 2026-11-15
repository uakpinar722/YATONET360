-- YG-1253: iş emrinde hedef bitiş başlangıçtan önce olamaz (yeni kayıtlarda denetlenir).
ALTER TABLE is_emri ADD CONSTRAINT is_emri_tarih_tutarli CHECK (hedef_bitis_tarihi IS NULL OR baslangic_tarihi IS NULL OR hedef_bitis_tarihi >= baslangic_tarihi) NOT VALID;
