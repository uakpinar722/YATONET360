-- YG-930: YATONET 360 aylık işletme gideri ve tavan. YG-066: akış sürümünün açık dosyalara uygulanma kararı.
INSERT INTO sistem_parametresi (kod, deger, aciklama) VALUES ('yatonet_aylik_tavan_eur', 1500, 'YATONET 360 aylık işletme gideri tavanı (EUR); üstü CEO onayıyla') ON CONFLICT (kod) DO NOTHING;
CREATE TABLE yatonet_gideri (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), ay text NOT NULL CHECK (ay ~ '^[0-9]{4}-[0-9]{2}$'), kalem text NOT NULL, saglayici text NOT NULL, tutar_eur numeric(12,2) NOT NULL CHECK (tutar_eur > 0), gerekce text,
  durum text NOT NULL DEFAULT 'Kayıtlı' CHECK (durum IN ('Kayıtlı', 'Onayda', 'Onaylandı', 'Reddedildi')), giren_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), zaman timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON yatonet_gideri TO yatonet_uygulama;
ALTER TABLE yayin_seti ADD COLUMN acik_dosya_karari text CHECK (acik_dosya_karari IN ('Açık dosyalara da uygulanır', 'Yalnız yeni dosyalara uygulanır')), ADD COLUMN acik_dosya_gerekcesi text;
ALTER TABLE dosya ADD COLUMN akis_surumu text;
CREATE FUNCTION dosya_akis_surumu() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  NEW.akis_surumu := coalesce(NEW.akis_surumu, (SELECT surum FROM yayin_seti WHERE ortam = 'Üretim' AND durum = 'Üretimde' ORDER BY uretim_zamani DESC LIMIT 1)); RETURN NEW; END $$;
CREATE TRIGGER dosya_akis_surumu BEFORE INSERT ON dosya FOR EACH ROW EXECUTE FUNCTION dosya_akis_surumu();
INSERT INTO durum_sozlugu (kayit_turu, durum, is_anlami, giris_kosulu, cikis_kosulu, yetkili_rol, izinli_gecisler, zorunlu_aciklama, sure_durur, otomatik_bildirim, musteri_adi) VALUES
 ('yatonet_gideri', 'Kayıtlı', 'Gider kaydedildi; aylık tavan içinde kaldığı için ayrıca onay gerekmez.', 'Ay toplamı tavanı aşmayan gider girilince', 'Son durum', 'Bilgi Teknolojileri ve Firma Yönetimi Direktörü', '{}'::text[], false, false, NULL, NULL),
 ('yatonet_gideri', 'Onayda', 'Kayıt onay zincirinde, sıradaki makamın kararını bekliyor; içerik değiştirilemez.', 'Ay toplamını tavanın üstüne çıkaran gider gerekçeyle girilince', 'CEO onaylayınca Onaylandı, reddedince Reddedildi', 'CEO', ARRAY['Onaylandı', 'Reddedildi']::text[], true, false, 'CEO''ya onay kartı', NULL),
 ('yatonet_gideri', 'Onaylandı', 'Kayıt son yetkili makam tarafından kabul edildi ve sonuç doğurur.', 'CEO onayıyla', 'Son durum', 'CEO', '{}'::text[], false, false, NULL, NULL),
 ('yatonet_gideri', 'Reddedildi', 'Kayıt yetkili makam tarafından kabul edilmedi; kayıt sonuç doğurmaz, gerekçe kayıtlıdır.', 'CEO reddedince', 'Son durum', 'CEO', '{}'::text[], true, false, NULL, NULL)
ON CONFLICT (kayit_turu, durum) DO NOTHING;
