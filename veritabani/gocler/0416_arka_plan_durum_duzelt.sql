-- YG-1354: durum sözlüğünde kayıt türü tablo adıdır; ortak durum adları sözlükteki tek anlamıyla tutulur.
UPDATE durum_sozlugu SET kayit_turu = 'arka_plan_isi' WHERE kayit_turu = 'Arka Plan İşi';
UPDATE durum_sozlugu SET is_anlami = 'İş başladı ve devam ediyor.' WHERE kayit_turu = 'arka_plan_isi' AND durum = 'Sürüyor';
UPDATE durum_sozlugu SET is_anlami = 'Kayıttaki iş bitti; gerekli kayıtlar oluştu.' WHERE kayit_turu = 'arka_plan_isi' AND durum = 'Tamamlandı';
