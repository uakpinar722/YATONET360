-- YG-807 (V-1144): uyum kuralının (MUM satırı) bağlı olduğu şablon metni, eğitim, sözleşme türü, belge türü ve iş emri adımı yapısal bağ olarak tutulur.
-- Resmî Gazete taramasında değişiklik işlenen kuralın gözden geçirilecekler listesi bu bağlardan çıkar. Bağ silinmez, gerekçeyle kaldırılınca Pasif olur.
CREATE TABLE uyum_kurali_bagi (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), mum_no text NOT NULL REFERENCES uyum_kurali (mum_no),
  bag_turu text NOT NULL CHECK (bag_turu IN ('Şablon Metni', 'Eğitim', 'Sözleşme Türü', 'Belge Türü', 'İş Emri Adımı')),
  bag_kodu text NOT NULL, aciklama text,
  durum text NOT NULL DEFAULT 'Aktif' CHECK (durum IN ('Aktif', 'Kaldırıldı')),
  ekleyen_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), olusturma_zamani timestamptz NOT NULL DEFAULT now(),
  kaldiran_ref text REFERENCES kullanici_hesabi (kimlik), kaldirma_zamani timestamptz, kaldirma_gerekcesi text
);
CREATE UNIQUE INDEX uyum_kurali_bagi_tekil ON uyum_kurali_bagi (mum_no, bag_turu, lower(bag_kodu)) WHERE durum = 'Aktif';
GRANT SELECT, INSERT, UPDATE ON uyum_kurali_bagi TO yatonet_uygulama;
INSERT INTO durum_sozlugu (kayit_turu, durum, is_anlami, giris_kosulu, cikis_kosulu, yetkili_rol, izinli_gecisler, zorunlu_aciklama, sure_durur, otomatik_bildirim, musteri_adi) VALUES
  ('uyum_kurali_bagi', 'Aktif', 'Kayıt yürürlükte ve kullanılıyor.', 'Hukuk ve Uyum Direktörü veya Uzmanı bağı ekleyince', 'Gerekçeyle kaldırılınca Kaldırıldı', 'Hukuk ve Uyum Direktörü', ARRAY['Kaldırıldı'], false, false, NULL, NULL),
  ('uyum_kurali_bagi', 'Kaldırıldı', 'Bağ artık geçerli değil; kural değişikliğinde gözden geçirilecekler listesine girmez.', 'Hukuk ve Uyum Direktörü veya Uzmanı gerekçeyle kaldırınca', 'Son durum; değişmez', 'Hukuk ve Uyum Direktörü', '{}'::text[], true, false, NULL, NULL);
