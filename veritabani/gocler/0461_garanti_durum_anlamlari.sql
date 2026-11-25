-- YG-899: ortak durum adları tek anlamlıdır; üretici başvurusu ve KDV iade dosyası ortak metinleri kullanır, kısmi kabul ayrı adla tutulur.
UPDATE durum_sozlugu SET is_anlami = 'Kayıt hazırlanma aşamasında.' WHERE kayit_turu IN ('uretici_garanti_basvurusu', 'kdv_iade_dosyasi') AND durum = 'Hazırlanıyor';
UPDATE durum_sozlugu SET is_anlami = 'Kayıt alıcısına iletildi; yanıt veya işlem bekleniyor.' WHERE kayit_turu = 'uretici_garanti_basvurusu' AND durum = 'Gönderildi';
UPDATE durum_sozlugu SET is_anlami = 'Kayıt değerlendirildi ve kabul edildi.' WHERE kayit_turu = 'uretici_garanti_basvurusu' AND durum = 'Kabul';
UPDATE durum_sozlugu SET is_anlami = 'Kayıt değerlendirildi ve kabul edilmedi.' WHERE kayit_turu = 'uretici_garanti_basvurusu' AND durum = 'Ret';
UPDATE durum_sozlugu SET is_anlami = 'Değerlendirme bitti ve sonuç kayda geçti.' WHERE kayit_turu = 'kdv_iade_dosyasi' AND durum = 'Sonuçlandı';
ALTER TABLE uretici_garanti_basvurusu DROP CONSTRAINT uretici_garanti_basvurusu_durum_check;
UPDATE uretici_garanti_basvurusu SET durum = 'Kısmen Kabul' WHERE durum = 'Kısmi Kabul';
ALTER TABLE uretici_garanti_basvurusu ADD CONSTRAINT uretici_garanti_basvurusu_durum_check CHECK (durum IN ('Hazırlanıyor', 'Gönderildi', 'Üretici İncelemesinde', 'Kabul', 'Kısmen Kabul', 'Ret'));
UPDATE durum_sozlugu SET durum = 'Kısmen Kabul' WHERE kayit_turu = 'uretici_garanti_basvurusu' AND durum = 'Kısmi Kabul';
UPDATE durum_sozlugu SET izinli_gecisler = array_replace(izinli_gecisler, 'Kısmi Kabul', 'Kısmen Kabul') WHERE kayit_turu = 'uretici_garanti_basvurusu';
