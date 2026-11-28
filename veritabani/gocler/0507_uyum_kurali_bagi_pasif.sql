-- YG-807: ortak durum adı tek anlamlıdır (YG-1365); gerekçeyle kaldırılan uyum kuralı bağı Pasif olur.
ALTER TABLE uyum_kurali_bagi DROP CONSTRAINT uyum_kurali_bagi_durum_check;
UPDATE uyum_kurali_bagi SET durum = 'Pasif' WHERE durum = 'Kaldırıldı';
ALTER TABLE uyum_kurali_bagi ADD CONSTRAINT uyum_kurali_bagi_durum_check CHECK (durum IN ('Aktif', 'Pasif'));
DELETE FROM durum_sozlugu WHERE kayit_turu = 'uyum_kurali_bagi' AND durum = 'Kaldırıldı';
UPDATE durum_sozlugu SET izinli_gecisler = ARRAY['Pasif'], cikis_kosulu = 'Gerekçeyle kaldırılınca Pasif' WHERE kayit_turu = 'uyum_kurali_bagi' AND durum = 'Aktif';
INSERT INTO durum_sozlugu (kayit_turu, durum, is_anlami, giris_kosulu, cikis_kosulu, yetkili_rol, izinli_gecisler, zorunlu_aciklama, sure_durur, otomatik_bildirim, musteri_adi) VALUES
  ('uyum_kurali_bagi', 'Pasif', 'Kayıt kullanım dışı; yeniden etkinleştirilmeden işlemde kullanılamaz.', 'Hukuk ve Uyum Direktörü veya Uzmanı gerekçeyle kaldırınca', 'Son durum; değişmez', 'Hukuk ve Uyum Direktörü', '{}'::text[], true, false, NULL, NULL);
