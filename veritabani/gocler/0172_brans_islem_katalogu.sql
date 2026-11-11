-- YG-1385: teknik branş ve işlem kodu kataloğu (LGM-2026-013); biçim düzeye uygun ve tekil; kod silinmez, yürürlükten kalkan kod yeniden kullanılmaz.
-- YG-858, YG-660: kartela kalemi, kodundaki tali branş üzerinden kataloğa bağlanır.
CREATE TABLE brans_kodu (
  kod text PRIMARY KEY, duzey text NOT NULL CHECK (duzey IN ('Ana Branş', 'Alt Branş', 'Tali Branş', 'İşlem')), ad text NOT NULL, ust_kod text REFERENCES brans_kodu (kod),
  durum text NOT NULL DEFAULT 'Yürürlükte' CHECK (durum IN ('Yürürlükte', 'Yürürlükten Kalktı')), kaynak text NOT NULL DEFAULT 'LGM-2026-013', kaldirma_gerekcesi text, kaldiran_ref text REFERENCES kullanici_hesabi (kimlik), zaman timestamptz NOT NULL DEFAULT now(),
  CHECK ((duzey = 'Ana Branş' AND kod ~ '^[A-ZÇĞİÖŞÜ]+-[0-9]{2}$' AND ust_kod IS NULL)
      OR (duzey = 'Alt Branş' AND kod ~ '^[A-ZÇĞİÖŞÜ]+-[0-9]{2}\.[0-9]{2}$' AND ust_kod = substring(kod from '^(.*)\.[0-9]{2}$'))
      OR (duzey = 'Tali Branş' AND kod ~ '^[A-ZÇĞİÖŞÜ]+-[0-9]{2}\.[0-9]{2}\.[0-9]{2}$' AND ust_kod = substring(kod from '^(.*)\.[0-9]{2}$'))
      OR (duzey = 'İşlem' AND kod ~ '^[A-ZÇĞİÖŞÜ]+-[0-9]{2}\.[0-9]{2}\.[0-9]{2}-I[0-9]{2}$' AND ust_kod = substring(kod from '^(.*)-I[0-9]{2}$')))
);
CREATE INDEX brans_kodu_ust ON brans_kodu (ust_kod);
CREATE FUNCTION brans_kodu_silinmez() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Branş ve işlem kodu silinmez; yürürlükten kaldırılır.'; END $$;
CREATE TRIGGER brans_kodu_silinmez BEFORE DELETE ON brans_kodu FOR EACH ROW EXECUTE FUNCTION brans_kodu_silinmez();
CREATE FUNCTION brans_kodu_degismez() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF NEW.kod <> OLD.kod OR NEW.duzey <> OLD.duzey OR NEW.ust_kod IS DISTINCT FROM OLD.ust_kod THEN RAISE EXCEPTION 'Kod, düzey ve üst kod değiştirilemez.'; END IF;
  IF OLD.durum = 'Yürürlükten Kalktı' AND NEW.durum = 'Yürürlükte' THEN RAISE EXCEPTION 'Yürürlükten kalkan kod yeniden kullanılamaz.'; END IF;
  RETURN NEW; END $$;
CREATE TRIGGER brans_kodu_degismez BEFORE UPDATE ON brans_kodu FOR EACH ROW EXECUTE FUNCTION brans_kodu_degismez();
GRANT SELECT, INSERT, UPDATE ON brans_kodu TO yatonet_uygulama;
INSERT INTO durum_sozlugu (kayit_turu, durum, is_anlami, giris_kosulu, cikis_kosulu, yetkili_rol, izinli_gecisler, zorunlu_aciklama, sure_durur, otomatik_bildirim, musteri_adi) VALUES
 ('brans_kodu', 'Yürürlükte', 'Kayıt onaylanmış ve geçerlilik süresi içinde uygulanıyor.', 'LGM-2026-013 kataloğundan aktarılınca veya yeni kod eklenince', 'Yetkili gerekçeyle kaldırınca Yürürlükten Kalktı', 'Teknik ve Operasyon Direktörü', ARRAY['Yürürlükten Kalktı']::text[], false, false, NULL, NULL),
 ('brans_kodu', 'Yürürlükten Kalktı', 'Kod kullanımdan kaldırıldı; geçmiş kayıtlar için saklanır, yeniden verilmez.', 'Gerekçeyle kaldırılınca', 'Son durum; kod yeniden kullanılamaz', 'Teknik ve Operasyon Direktörü', '{}'::text[], true, false, NULL, NULL)
ON CONFLICT (kayit_turu, durum) DO NOTHING;
