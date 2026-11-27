-- YG-060, V-1109: eğitim denemesi durumları ortak durum sözlüğündeki tek anlamlı adlara bağlanır (Başarılı yedek kaydında başka anlamdadır).
ALTER TABLE egitim_denemesi DROP CONSTRAINT egitim_denemesi_durum_check;
UPDATE egitim_denemesi SET durum = CASE durum WHEN 'Başarılı' THEN 'Geçti' WHEN 'Başarısız' THEN 'Kaldı' WHEN 'Sıfırlandı' THEN 'İptal' ELSE durum END;
ALTER TABLE egitim_denemesi ADD CONSTRAINT egitim_denemesi_durum_check CHECK (durum IN ('Sürüyor', 'Geçti', 'Kaldı', 'İptal'));
INSERT INTO durum_sozlugu (kayit_turu, durum, is_anlami, giris_kosulu, cikis_kosulu, yetkili_rol, izinli_gecisler, zorunlu_aciklama, sure_durur, otomatik_bildirim, musteri_adi) VALUES
  ('egitim_denemesi', 'Sürüyor', 'İş başladı ve devam ediyor.', 'Kullanıcı senaryoyu başlatınca', 'Son adım cevaplanınca Geçti veya Kaldı; kullanıcı sıfırlarsa İptal', 'Sistem', ARRAY['Geçti', 'Kaldı', 'İptal'], false, false, NULL, NULL),
  ('egitim_denemesi', 'Geçti', 'Senaryo geçme puanına süresi içinde ulaşıldı; başarı kaydı yazıldı.', 'Puan geçme oranına ulaşır ve süre aşılmazsa', 'Yok', 'Sistem', '{}'::text[], false, false, NULL, NULL),
  ('egitim_denemesi', 'Kaldı', 'Senaryo geçme puanına ulaşılamadı veya süre aşıldı.', 'Puan geçme oranının altında kalır ya da süre aşılırsa', 'Yok', 'Sistem', '{}'::text[], false, false, NULL, NULL),
  ('egitim_denemesi', 'İptal', 'Kayıt sonuçlanmadan geçersiz kılındı; sonuç doğurmaz.', 'Kullanıcı senaryoyu sıfırlayınca', 'Yok', 'Sistem', '{}'::text[], false, false, NULL, NULL)
ON CONFLICT DO NOTHING;
