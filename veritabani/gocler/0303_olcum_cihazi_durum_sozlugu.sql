-- YG-402, YG-1365: ölçüm cihazı durumlarının sözlük tanımı.
INSERT INTO durum_sozlugu (kayit_turu, durum, is_anlami, giris_kosulu, cikis_kosulu, yetkili_rol, izinli_gecisler, zorunlu_aciklama, sure_durur, otomatik_bildirim, musteri_adi) VALUES
  ('olcum_cihazi', 'Kullanımda', 'Cihaz kalibrasyonu (kritik cihazda ara doğrulaması) geçerli olduğu sürece testte kullanılabilir.', 'Kalibrasyon kabul kararı Evet ile kayıt', 'Kalibrasyon kabulü Hayır olursa Karantina', 'Kalite Müdürü', ARRAY['Karantina']::text[], false, false, NULL, NULL),
  ('olcum_cihazi', 'Karantina', 'Kayıt şüpheli bulunduğu için ayrıldı; inceleme bitmeden kullanılmaz.', 'Kalibrasyon kabul kararı Hayır', 'Yeni kalibrasyon kabulüyle Kullanımda', 'Kalite Müdürü', ARRAY['Kullanımda']::text[], true, false, NULL, NULL)
ON CONFLICT DO NOTHING;
