-- YG-1131: değişiklik bileti alanları.
ALTER TABLE degisiklik_bileti ADD COLUMN mevcut_davranis text, ADD COLUMN beklenen_sonuc text, ADD COLUMN talep_sahibi text, ADD COLUMN etkilenen_kullanicilar text, ADD COLUMN kabul_olcutu text;
