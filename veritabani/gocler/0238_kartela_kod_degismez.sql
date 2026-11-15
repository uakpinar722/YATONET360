-- YG-857: verilmiş kartela kodu değiştirilemez.
CREATE OR REPLACE FUNCTION kartela_kod_degismez() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.kod IS DISTINCT FROM OLD.kod THEN RAISE EXCEPTION 'Kartela kalem kodu değiştirilemez'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER kartela_kod_degismez BEFORE UPDATE OF kod ON kartela_kalemi FOR EACH ROW EXECUTE FUNCTION kartela_kod_degismez();
