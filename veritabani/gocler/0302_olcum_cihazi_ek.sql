-- YG-402: kritik cihaz ara doğrulaması, karantina durumu ve TÜRKAK akreditasyonu.
ALTER TABLE olcum_cihazi ADD COLUMN kritik boolean NOT NULL DEFAULT false, ADD COLUMN ara_dogrulama_tarihi date,
  ADD COLUMN durum text NOT NULL DEFAULT 'Kullanımda' CHECK (durum IN ('Kullanımda', 'Karantina')), ADD COLUMN turkak_akredite boolean NOT NULL DEFAULT false, ADD COLUMN kalibrasyon_kurulusu text;
UPDATE olcum_cihazi SET durum = 'Karantina' WHERE NOT kabul;
