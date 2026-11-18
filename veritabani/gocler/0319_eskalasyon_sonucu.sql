-- YG-536: eskalasyonun beklenen eylemi ve kapanış sonucu.
ALTER TABLE kart_sure_kaydi ADD COLUMN beklenen_eylem text, ADD COLUMN kapanis_sonucu text, ADD COLUMN kapanis_zamani timestamptz;
CREATE FUNCTION kart_sure_kapanis() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NEW.kapanma_zamani IS NOT NULL AND OLD.kapanma_zamani IS NULL THEN
    UPDATE kart_sure_kaydi SET kapanis_sonucu = NEW.durum, kapanis_zamani = NEW.kapanma_zamani WHERE is_ref = NEW.kimlik AND kapanis_sonucu IS NULL;
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER kart_sure_kapanis AFTER UPDATE OF kapanma_zamani ON is_karti FOR EACH ROW EXECUTE FUNCTION kart_sure_kapanis();
