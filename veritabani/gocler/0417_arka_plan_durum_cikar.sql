-- YG-1354: arka_plan_isi.sonuc bir durum sütunu değildir (durum kaynağı yalnız durum/statü sütunlarını okur); sözlükteki fazla satırlar çıkarılır.
DELETE FROM durum_sozlugu WHERE kayit_turu = 'arka_plan_isi';
