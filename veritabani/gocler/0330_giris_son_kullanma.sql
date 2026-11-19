-- YG-1590: raf ömrü uyarısı için malzeme giriş kaydında son kullanma tarihi (raf ömrü olan malzemede girilir).
ALTER TABLE malzeme_giris_kabulu ADD COLUMN son_kullanma date;
