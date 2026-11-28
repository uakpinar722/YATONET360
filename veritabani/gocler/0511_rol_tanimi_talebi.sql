-- YG-1009: rol tanımını (iş amacı, sahip rol, gözden geçirme dönemi) Sistem Yöneticisi hazırlar, rolün bağlı olduğu birim Müdürü onaylar; onaydan önce uygulanmaz.
CREATE TABLE rol_tanimi_talebi (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rol_ref text NOT NULL REFERENCES rol (kimlik),
  is_amaci text NOT NULL, sahip_rol_ref text NOT NULL REFERENCES rol (kimlik), gozden_gecirme_ay int NOT NULL CHECK (gozden_gecirme_ay BETWEEN 1 AND 36),
  hazirlayan_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik),
  durum text NOT NULL DEFAULT 'Onay Bekliyor' CHECK (durum IN ('Onay Bekliyor', 'Onaylandı', 'Reddedildi')),
  olusturma_zamani timestamptz NOT NULL DEFAULT now(), karar_zamani timestamptz
);
CREATE UNIQUE INDEX rol_tanimi_talebi_acik ON rol_tanimi_talebi (rol_ref) WHERE durum = 'Onay Bekliyor';
GRANT SELECT, INSERT, UPDATE ON rol_tanimi_talebi TO yatonet_uygulama;
INSERT INTO durum_sozlugu (kayit_turu, durum, is_anlami, giris_kosulu, cikis_kosulu, yetkili_rol, izinli_gecisler, zorunlu_aciklama, sure_durur, otomatik_bildirim, musteri_adi) VALUES
  ('rol_tanimi_talebi', 'Onay Bekliyor', 'Kayıt hazırlandı, yetkili makamın onayını bekliyor.', 'Sistem Yöneticisi veya Bilgi İşlem Müdürü rolün iş amacını, sahip rolünü ve gözden geçirme dönemini hazırlayınca', 'Rolün bağlı olduğu birim Müdürünün kararıyla Onaylandı veya Reddedildi', 'Rolün bağlı olduğu birim Müdürü', ARRAY['Onaylandı', 'Reddedildi'], false, false, 'Onay kartı', NULL),
  ('rol_tanimi_talebi', 'Onaylandı', 'Kayıt son yetkili makam tarafından kabul edildi ve sonuç doğurur.', 'Birim Müdürü onaylayınca; tanım role uygulanır', 'Yok', 'Rolün bağlı olduğu birim Müdürü', ARRAY[]::text[], false, false, NULL, NULL),
  ('rol_tanimi_talebi', 'Reddedildi', 'Kayıt yetkili makam tarafından kabul edilmedi; kayıt sonuç doğurmaz, gerekçe kayıtlıdır.', 'Onay zincirinde reddedilince', 'Yok', 'Rolün bağlı olduğu birim Müdürü', ARRAY[]::text[], true, false, NULL, NULL);
