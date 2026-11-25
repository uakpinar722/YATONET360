-- YG-104: LGM veya Çözüm Ortağı ancak Hukuk ve Uyum Direktörü onayıyla yediemin olur; onaysız yediemin kaydı sonuç doğurmaz.
CREATE TABLE yediemin_talebi (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), dosya_ref uuid NOT NULL REFERENCES dosya (kimlik), yediemin text NOT NULL CHECK (yediemin IN ('LGM', 'Çözüm Ortağı')), kurulus_ref uuid REFERENCES kurulus (kimlik),
  dayanak text NOT NULL, belge_ref uuid REFERENCES belge (kimlik), durum text NOT NULL DEFAULT 'Onay Bekliyor' CHECK (durum IN ('Onay Bekliyor', 'Onaylandı', 'Reddedildi')),
  hazirlayan_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), olusturma_zamani timestamptz NOT NULL DEFAULT now(), karar_zamani timestamptz, CHECK ((yediemin = 'Çözüm Ortağı') = (kurulus_ref IS NOT NULL))
);
GRANT SELECT, INSERT, UPDATE ON yediemin_talebi TO yatonet_uygulama;
INSERT INTO durum_sozlugu (kayit_turu, durum, is_anlami, giris_kosulu, cikis_kosulu, yetkili_rol, izinli_gecisler, zorunlu_aciklama, sure_durur, otomatik_bildirim, musteri_adi) VALUES
  ('yediemin_talebi', 'Onay Bekliyor', 'Kayıt hazırlandı, yetkili makamın onayını bekliyor.', 'Dosya Sorumlusu yediemin, dayanak ve belgeyle talep açınca', 'Hukuk ve Uyum Direktörü kararıyla Onaylandı veya Reddedildi', 'Hukuk ve Uyum Direktörü', ARRAY['Onaylandı', 'Reddedildi'], false, false, 'Onay kartı', NULL),
  ('yediemin_talebi', 'Onaylandı', 'Kayıt son yetkili makam tarafından kabul edildi ve sonuç doğurur.', 'Hukuk ve Uyum Direktörü onaylayınca', 'Yok', 'Hukuk ve Uyum Direktörü', '{}'::text[], false, false, NULL, NULL),
  ('yediemin_talebi', 'Reddedildi', 'Kayıt yetkili makam tarafından kabul edilmedi; kayıt sonuç doğurmaz, gerekçe kayıtlıdır.', 'Onay zincirinde reddedilince', 'Yok', 'Hukuk ve Uyum Direktörü', '{}'::text[], true, false, NULL, NULL)
ON CONFLICT DO NOTHING;
