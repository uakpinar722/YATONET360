-- YG-008: kapsam ve metraj cetveli numarası dosya no + -MT01 (dosyada tek cetvel; sürüm Rev.n ile izlenir).
ALTER TABLE kapsam_cetveli ADD COLUMN cetvel_no text;
CREATE FUNCTION cetvel_no_ver() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.cetvel_no IS NULL THEN SELECT dosya_no || '-MT01' INTO NEW.cetvel_no FROM dosya WHERE kimlik = NEW.dosya_ref; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER cetvel_no_ver BEFORE INSERT ON kapsam_cetveli FOR EACH ROW EXECUTE FUNCTION cetvel_no_ver();
UPDATE kapsam_cetveli c SET cetvel_no = d.dosya_no || '-MT01' FROM dosya d WHERE d.kimlik = c.dosya_ref AND c.cetvel_no IS NULL;
