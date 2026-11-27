-- YG-1244 (V-1134): mükerrer personel hesaplarının İnsan Kaynakları Müdürü kararıyla birleştirilmesi. Geçmiş kayıtlar ve işlem izi eski hesapta kalır;
-- güncel bağlar (aktif rol, açık dosya görevi, bekleyen iş kartı, personel kartı) taşınır, eski hesap kapanır ve ana hesaba yönlenir; birleştirme geri alınabilir.
ALTER TABLE kullanici_hesabi ADD COLUMN birlestirilen_ana_ref text REFERENCES kullanici_hesabi (kimlik);
CREATE TABLE hesap_birlestirme (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), ana_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), eski_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik),
  gerekce text NOT NULL, tasinan jsonb NOT NULL DEFAULT '{}',
  durum text NOT NULL DEFAULT 'Ana Kayda Bağlandı' CHECK (durum IN ('Ana Kayda Bağlandı', 'Geri Alındı')),
  yapan_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), zaman timestamptz NOT NULL DEFAULT now(),
  geri_alan_ref text REFERENCES kullanici_hesabi (kimlik), geri_alma_zamani timestamptz
);
CREATE INDEX hesap_birlestirme_eski ON hesap_birlestirme (eski_ref);
GRANT SELECT, INSERT, UPDATE ON hesap_birlestirme TO yatonet_uygulama;
GRANT UPDATE (hesap_durumu, birlestirilen_ana_ref) ON kullanici_hesabi TO yatonet_uygulama;
GRANT UPDATE (kullanici_ref, atama_durumu) ON rol_atamasi TO yatonet_uygulama;
GRANT UPDATE (kullanici_ref) ON dosya_ekibi_atamasi TO yatonet_uygulama;
GRANT UPDATE (sahip_kullanici_ref) ON is_karti TO yatonet_uygulama;
GRANT UPDATE (kullanici_ref) ON personel_karti TO yatonet_uygulama;
INSERT INTO durum_sozlugu (kayit_turu, durum, is_anlami, giris_kosulu, cikis_kosulu, yetkili_rol, izinli_gecisler, zorunlu_aciklama, sure_durur, otomatik_bildirim, musteri_adi) VALUES
  ('hesap_birlestirme', 'Ana Kayda Bağlandı', 'Mükerrer kayıt ana kayda bağlandı; ilişkileri taşındı, eski kimlik yönlendirme için korunuyor.', 'İnsan Kaynakları Müdürü ana hesabı seçip gerekçeyle birleştirince', 'Birleştirme gerekçeyle geri alınınca Geri Alındı', 'İnsan Kaynakları Müdürü', ARRAY['Geri Alındı']::text[], true, false, NULL, NULL),
  ('hesap_birlestirme', 'Geri Alındı', 'Uygulanmış işlem geri alındı; önceki durum geri getirildi.', 'İnsan Kaynakları Müdürü birleştirmeyi geri alınca', 'Son durum; değişmez', 'İnsan Kaynakları Müdürü', '{}'::text[], true, false, NULL, NULL);
