-- YG-948 (V-1110): yıllık izinde yaş kuralı için İK'nın girdiği doğum tarihi (personel kartı Gizli sınıftadır).
ALTER TABLE personel_karti ADD COLUMN dogum_tarihi date CHECK (dogum_tarihi > '1900-01-01');
