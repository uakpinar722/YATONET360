-- YG-1526: marka kodu tekil anahtardır: bir kod tek markaya, bir marka (büyük/küçük harf duyarsız) tek koda karşılık gelir. Toplu yenilemede ara adımlar
-- geçici olarak ihlal edebileceğinden denetim işlem sonunda yapılır.
CREATE FUNCTION marka_kodu_tekil() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM yat_marka_model WHERE (marka_kodu = NEW.marka_kodu AND lower(marka) <> lower(NEW.marka)) OR (lower(marka) = lower(NEW.marka) AND marka_kodu <> NEW.marka_kodu)) THEN
    RAISE EXCEPTION 'Marka kodu ve marka adı bire bir olmalıdır: % / %', NEW.marka_kodu, NEW.marka USING ERRCODE = '23505';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER marka_kodu_tekil AFTER INSERT OR UPDATE OF marka_kodu, marka ON yat_marka_model DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION marka_kodu_tekil();
CREATE INDEX yat_marka_model_kod ON yat_marka_model (marka_kodu);

CREATE TABLE marka_model_aktarimi (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), dosya_adi text NOT NULL, ozet_sha256 text NOT NULL,
  dosya_satir integer NOT NULL, dosya_marka integer NOT NULL, dosya_durum jsonb NOT NULL,
  aktarilan_satir integer NOT NULL, aktarilan_marka integer NOT NULL, aktarilan_durum jsonb NOT NULL,
  eklenen integer NOT NULL, guncellenen integer NOT NULL, kod_degisen_marka integer NOT NULL, listede_olmayan integer NOT NULL,
  sonuc text NOT NULL CHECK (sonuc IN ('Uyumlu', 'Uyumsuz', 'Hatalı')), hata text, yapan_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), zaman timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON marka_model_aktarimi TO yatonet_uygulama;
GRANT INSERT, UPDATE ON yat_marka_model TO yatonet_uygulama;
