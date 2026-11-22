-- YG-1652: deyim düzeyindeki tetikleyicide NEW bulunmaz; parametre kodu yalnız satır düzeyinde (sistem_parametresi) okunur.
CREATE OR REPLACE FUNCTION kural_degisikligi_yaz() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_LEVEL = 'ROW' AND TG_TABLE_NAME = 'sistem_parametresi' THEN
    INSERT INTO kural_degisikligi (kaynak, anahtar) VALUES (TG_TABLE_NAME, NEW.kod);
  ELSE
    INSERT INTO kural_degisikligi (kaynak) VALUES (TG_TABLE_NAME);
  END IF;
  RETURN NULL;
END $$;
