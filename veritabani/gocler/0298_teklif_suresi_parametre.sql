-- YG-043: teklif süresi parametredir; keşiften teklife toplam hedef ayrı sayaçtır.
INSERT INTO sistem_parametresi (kod, deger, aciklama) VALUES
  ('teklif_saat_yuksek', 48, 'Teklif süresi – Yüksek öncelik (takvim saati)'),
  ('teklif_saat_normal', 72, 'Teklif süresi – Normal öncelik (takvim saati)'),
  ('teklif_saat_planli', 120, 'Teklif süresi – Planlı öncelik (takvim saati)')
ON CONFLICT (kod) DO NOTHING;
ALTER TABLE dosya_sure DROP CONSTRAINT IF EXISTS dosya_sure_tur_check;
ALTER TABLE dosya_sure ADD CONSTRAINT dosya_sure_tur_check CHECK (tur IN ('İlk Yanıt', 'Teknik Uzman Ataması', 'Randevu İletişimi', 'Keşif', 'Teklif', 'Sahaya Ulaşma', 'Keşiften Teklife'));
