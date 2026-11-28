-- YG-1686: A sınıfı serbest bırakma Kalite Uzmanından "Onaya Gönder" ile Teknik Yönetici ve Kalite Müdürüne gider; "Serbest Bırak" veya "Gerekçeyle İade Et".
ALTER TABLE kontrol_noktasi
  ADD COLUMN onaya_gonderen_ref text REFERENCES kullanici_hesabi (kimlik),
  ADD COLUMN onaya_gonderme_zamani timestamptz,
  ADD COLUMN iade_gerekcesi text,
  ADD COLUMN iade_eden_ref text REFERENCES kullanici_hesabi (kimlik),
  ADD COLUMN iade_zamani timestamptz;
