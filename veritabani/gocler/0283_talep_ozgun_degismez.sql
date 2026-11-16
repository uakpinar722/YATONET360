-- YG-002: talep kaydının özgün bildirimi ve bildirimin alındığı an değiştirilemez.
CREATE FUNCTION talep_ozgun_koru() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (OLD.ozgun_bildirim IS NOT NULL AND NEW.ozgun_bildirim IS DISTINCT FROM OLD.ozgun_bildirim) OR NEW.bildirim_alinma_zamani IS DISTINCT FROM OLD.bildirim_alinma_zamani THEN
    RAISE EXCEPTION 'Talebin özgün bildirimi değiştirilemez.' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER talep_ozgun_koru BEFORE UPDATE ON talep FOR EACH ROW EXECUTE FUNCTION talep_ozgun_koru();
