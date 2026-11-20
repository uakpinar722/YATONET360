-- YG-969: periyot türü; olaya bağlı işin sabit tarihi yoktur. Sonraki tarih tek fonksiyonla hesaplanır.
ALTER TABLE periyodik_is ADD COLUMN periyot_turu text NOT NULL DEFAULT 'Aylık' CHECK (periyot_turu IN ('Günlük', 'Haftalık', 'Aylık', '3 Aylık', '6 Aylık', 'Yıllık', 'Sezonluk', 'Olaya Bağlı'));
ALTER TABLE periyodik_is ALTER COLUMN sonraki_tarih DROP NOT NULL;
UPDATE periyodik_is SET periyot_turu = CASE periyot_ay WHEN 3 THEN '3 Aylık' WHEN 6 THEN '6 Aylık' WHEN 12 THEN 'Yıllık' ELSE 'Aylık' END;
CREATE FUNCTION periyodik_sonraki(t date, tur text, ay integer) RETURNS date LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE tur WHEN 'Günlük' THEN t + 1 WHEN 'Haftalık' THEN t + 7 WHEN 'Olaya Bağlı' THEN NULL ELSE (t + make_interval(months => ay))::date END
$$;
