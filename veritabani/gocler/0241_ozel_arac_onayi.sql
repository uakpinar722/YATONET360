-- YG-922: Saha Sorumlusu dışındaki personelin özel araç kullanımı ön onayı.
CREATE TABLE ozel_arac_onayi (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  personel_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik),
  tarih date NOT NULL, guzergah text NOT NULL, gerekce text NOT NULL,
  durum text NOT NULL DEFAULT 'Onayda' CHECK (durum IN ('Onayda', 'Onaylandı', 'Reddedildi')),
  olusturma_zamani timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON ozel_arac_onayi TO yatonet_uygulama;
INSERT INTO durum_sozlugu (kayit_turu, durum, is_anlami, giris_kosulu, cikis_kosulu, yetkili_rol, izinli_gecisler, zorunlu_aciklama, sure_durur, otomatik_bildirim, musteri_adi) VALUES
  ('ozel_arac_onayi', 'Onayda', 'Kayıt onay zincirinde, sıradaki makamın kararını bekliyor; içerik değiştirilemez.', 'Personel yolculuktan önce özel araç kullanım onayı isteyince', 'Birim amiri onaylarsa Onaylandı, reddederse Reddedildi', 'Birim amiri', ARRAY['Onaylandı', 'Reddedildi']::text[], false, false, 'Birim amirine onay kartı', NULL),
  ('ozel_arac_onayi', 'Onaylandı', 'Kayıt son yetkili makam tarafından kabul edildi ve sonuç doğurur.', 'Birim amiri onaylayınca', 'Son durum; o günün km masrafı girilebilir', 'Birim amiri', ARRAY[]::text[], false, false, NULL, NULL),
  ('ozel_arac_onayi', 'Reddedildi', 'Kayıt yetkili makam tarafından kabul edilmedi; kayıt sonuç doğurmaz, gerekçe kayıtlıdır.', 'Birim amiri reddedince', 'Son durum', 'Birim amiri', ARRAY[]::text[], true, false, NULL, NULL)
ON CONFLICT DO NOTHING;
