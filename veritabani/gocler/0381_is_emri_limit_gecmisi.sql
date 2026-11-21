-- YG-323: iş emri mali limitinin her değişikliği sürüm olarak kaydedilir.
CREATE TABLE is_emri_limit_gecmisi (
  kimlik bigserial PRIMARY KEY, is_emri_ref uuid NOT NULL REFERENCES is_emri (kimlik), eski_limit_eur numeric(14,2), yeni_limit_eur numeric(14,2), zaman timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX is_emri_limit_gecmisi_is_emri ON is_emri_limit_gecmisi (is_emri_ref);
CREATE OR REPLACE FUNCTION is_emri_limit_yaz() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (TG_OP = 'INSERT' AND NEW.firma_bedeli_eur IS NOT NULL) OR (TG_OP = 'UPDATE' AND NEW.firma_bedeli_eur IS DISTINCT FROM OLD.firma_bedeli_eur) THEN
    INSERT INTO is_emri_limit_gecmisi (is_emri_ref, eski_limit_eur, yeni_limit_eur) VALUES (NEW.kimlik, CASE WHEN TG_OP = 'UPDATE' THEN OLD.firma_bedeli_eur END, NEW.firma_bedeli_eur);
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER is_emri_limit_yaz AFTER INSERT OR UPDATE OF firma_bedeli_eur ON is_emri FOR EACH ROW EXECUTE FUNCTION is_emri_limit_yaz();
INSERT INTO is_emri_limit_gecmisi (is_emri_ref, yeni_limit_eur, zaman) SELECT kimlik, firma_bedeli_eur, coalesce(yayim_zamani, olusturma_zamani) FROM is_emri WHERE firma_bedeli_eur IS NOT NULL;
GRANT SELECT, INSERT ON is_emri_limit_gecmisi TO yatonet_uygulama;
GRANT USAGE ON SEQUENCE is_emri_limit_gecmisi_kimlik_seq TO yatonet_uygulama;
