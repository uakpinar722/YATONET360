-- 0187'deki "Reddedildi" anlamı ortak sözlük anlamıyla birleştirilir (YG-1365).
UPDATE durum_sozlugu SET is_anlami = 'Kayıt yetkili makam tarafından kabul edilmedi; kayıt sonuç doğurmaz, gerekçe kayıtlıdır.' WHERE kayit_turu = 'dosya_siniri_onerisi' AND durum = 'Reddedildi';
