-- YG-406: sökülen parçanın akıbeti altı değerle kaydedilir.
ALTER TABLE sokulen_parca DROP CONSTRAINT sokulen_parca_sonuc_check;
UPDATE sokulen_parca SET sonuc = CASE sonuc WHEN 'Teslim Edildi' THEN 'Müşteriye İade' WHEN 'İmha Edildi' THEN 'Hurda' ELSE sonuc END WHERE sonuc IS NOT NULL;
ALTER TABLE sokulen_parca ADD CONSTRAINT sokulen_parca_sonuc_check CHECK (sonuc IN ('Yeniden Kullanım', 'İnceleme-Delil', 'Müşteriye İade', 'Garanti İadesi', 'Hurda', 'Çevresel Bertaraf'));
