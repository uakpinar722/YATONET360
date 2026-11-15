-- YG-1246: veri düzeltme talebi.
CREATE TABLE veri_duzeltme_talebi (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nesne_turu text NOT NULL CHECK (nesne_turu IN ('Yat')), nesne_ref uuid NOT NULL,
  alan text NOT NULL, mevcut_deger text, dogru_deger text NOT NULL, kaynak text NOT NULL, etkilenen text NOT NULL,
  durum text NOT NULL DEFAULT 'Onayda' CHECK (durum IN ('Onayda', 'Onaylandı', 'Reddedildi')),
  talep_eden_ref text NOT NULL, olusturma_zamani timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON veri_duzeltme_talebi TO yatonet_uygulama;
INSERT INTO durum_sozlugu (kayit_turu, durum, is_anlami, giris_kosulu, cikis_kosulu, yetkili_rol, izinli_gecisler, zorunlu_aciklama, sure_durur, otomatik_bildirim, musteri_adi) VALUES
  ('veri_duzeltme_talebi', 'Onayda', 'Kayıt onay zincirinde, sıradaki makamın kararını bekliyor; içerik değiştirilemez.', 'LGM kullanıcısı hatalı alanı, doğru değeri, kaynağı ve etkilenen işlemleri yazınca', 'Operasyon Müdürü onaylarsa Onaylandı, reddederse Reddedildi', 'Operasyon Müdürü', ARRAY['Onaylandı', 'Reddedildi']::text[], false, false, 'Operasyon Müdürüne onay kartı', NULL),
  ('veri_duzeltme_talebi', 'Onaylandı', 'Kayıt son yetkili makam tarafından kabul edildi ve sonuç doğurur.', 'Operasyon Müdürü onaylayınca', 'Son durum; alan düzeltilir, önceki değer denetim izinde kalır', 'Operasyon Müdürü', ARRAY[]::text[], false, false, NULL, NULL),
  ('veri_duzeltme_talebi', 'Reddedildi', 'Kayıt yetkili makam tarafından kabul edilmedi; kayıt sonuç doğurmaz, gerekçe kayıtlıdır.', 'Operasyon Müdürü reddedince', 'Son durum', 'Operasyon Müdürü', ARRAY[]::text[], true, false, NULL, NULL)
ON CONFLICT DO NOTHING;
