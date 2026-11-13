-- YG-685: kontrol listesi yanıtları Evet / Hayır / Uygulanmaz.
UPDATE kontrol_listesi_maddesi SET sonuc = CASE sonuc WHEN 'Uygun' THEN 'Evet' WHEN 'Uygun Değil' THEN 'Hayır' WHEN 'Geçerli Değil' THEN 'Uygulanmaz' ELSE sonuc END WHERE sonuc IN ('Uygun', 'Uygun Değil', 'Geçerli Değil');
