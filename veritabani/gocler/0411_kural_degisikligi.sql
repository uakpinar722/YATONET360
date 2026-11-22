-- YG-1652: öz denetimi kendiliğinden başlatan kural ve parametre değişiklikleri.
CREATE TABLE kural_degisikligi (kimlik bigserial PRIMARY KEY, kaynak text NOT NULL, anahtar text, zaman timestamptz NOT NULL DEFAULT now());
CREATE INDEX kural_degisikligi_zaman ON kural_degisikligi (zaman);
GRANT SELECT ON kural_degisikligi TO yatonet_uygulama;
CREATE FUNCTION kural_degisikligi_yaz() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO kural_degisikligi (kaynak, anahtar) VALUES (TG_TABLE_NAME, CASE TG_TABLE_NAME WHEN 'sistem_parametresi' THEN coalesce(NEW.kod, OLD.kod) ELSE NULL END);
  RETURN NULL;
END $$;
CREATE TRIGGER kural_degisikligi AFTER UPDATE OF deger ON sistem_parametresi FOR EACH ROW WHEN (OLD.deger IS DISTINCT FROM NEW.deger) EXECUTE FUNCTION kural_degisikligi_yaz();
CREATE TRIGGER kural_degisikligi AFTER INSERT OR UPDATE OR DELETE ON rol_izni FOR EACH STATEMENT EXECUTE FUNCTION kural_degisikligi_yaz();
CREATE TRIGGER kural_degisikligi AFTER INSERT OR UPDATE OR DELETE ON kalite_kurali FOR EACH STATEMENT EXECUTE FUNCTION kural_degisikligi_yaz();
