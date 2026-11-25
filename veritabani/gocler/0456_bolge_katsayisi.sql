-- YG-856, KS-11 (CEO 17.11.2026): kartela birim fiyatı bölge katsayısıyla çarpılır; 8 bölgenin tamamı 1,00, değişiklik onayla yapılır.
CREATE TABLE bolge_katsayisi (bolge text PRIMARY KEY, katsayi numeric(4,2) NOT NULL DEFAULT 1.00 CHECK (katsayi > 0), guncelleme_zamani timestamptz NOT NULL DEFAULT now());
INSERT INTO bolge_katsayisi (bolge) VALUES ('1. Marmara'), ('2. Kuzey Ege'), ('3. Güney Ege'), ('4. Batı Akdeniz'), ('5. Antalya'), ('6. Doğu Akdeniz'), ('7. Karadeniz'), ('8. İç sular ve ulusal havuz') ON CONFLICT DO NOTHING;
CREATE TABLE bolge_katsayisi_talebi (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), bolge text NOT NULL REFERENCES bolge_katsayisi (bolge), yeni_katsayi numeric(4,2) NOT NULL CHECK (yeni_katsayi > 0), gerekce text NOT NULL,
  durum text NOT NULL DEFAULT 'Onay Bekliyor' CHECK (durum IN ('Onay Bekliyor', 'Onaylandı', 'Reddedildi')), hazirlayan_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), olusturma_zamani timestamptz NOT NULL DEFAULT now(), karar_zamani timestamptz
);
GRANT SELECT, UPDATE ON bolge_katsayisi TO yatonet_uygulama;
GRANT SELECT, INSERT, UPDATE ON bolge_katsayisi_talebi TO yatonet_uygulama;
INSERT INTO durum_sozlugu (kayit_turu, durum, is_anlami, giris_kosulu, cikis_kosulu, yetkili_rol, izinli_gecisler, zorunlu_aciklama, sure_durur, otomatik_bildirim, musteri_adi) VALUES
  ('bolge_katsayisi_talebi', 'Onay Bekliyor', 'Kayıt hazırlandı, yetkili makamın onayını bekliyor.', 'Ticari İşler Direktörü bölge, yeni katsayı ve gerekçeyle talep hazırlayınca', 'Genel Müdür Yardımcısı uygun görüşü ve CEO kararıyla Onaylandı veya Reddedildi', 'CEO', ARRAY['Onaylandı', 'Reddedildi'], false, false, 'Onay kartı', NULL),
  ('bolge_katsayisi_talebi', 'Onaylandı', 'Kayıt son yetkili makam tarafından kabul edildi ve sonuç doğurur.', 'CEO onaylayınca; katsayı yeni tekliflerde uygulanır', 'Yok', 'CEO', '{}'::text[], false, false, NULL, NULL),
  ('bolge_katsayisi_talebi', 'Reddedildi', 'Kayıt yetkili makam tarafından kabul edilmedi; kayıt sonuç doğurmaz, gerekçe kayıtlıdır.', 'Onay zincirinde reddedilince', 'Yok', 'CEO', '{}'::text[], true, false, NULL, NULL)
ON CONFLICT DO NOTHING;
-- YG-1662 (CEO 25.11.2026: karar süresini belirle): kabul kararı itirazı 15 günde karara bağlanır (firmanın itiraz süresiyle aynı).
UPDATE sistem_parametresi SET deger = 15 WHERE kod = 'kabul_itirazi_karar_suresi_gun';
