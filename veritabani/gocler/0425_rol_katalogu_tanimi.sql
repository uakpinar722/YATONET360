-- YG-1007: rol kataloğu iş amacı, sahip rol ve gözden geçirme dönemi; katalogdan yüklenmeyen (yeni) rolde sahipsiz atama engeli.
ALTER TABLE rol ADD COLUMN is_amaci text, ADD COLUMN sahip_rol_ref text REFERENCES rol (kimlik), ADD COLUMN gozden_gecirme_ay integer CHECK (gozden_gecirme_ay BETWEEN 1 AND 36),
  ADD COLUMN katalog_rolu boolean NOT NULL DEFAULT false;
UPDATE rol SET katalog_rolu = true;
GRANT UPDATE (is_amaci, sahip_rol_ref, gozden_gecirme_ay) ON rol TO yatonet_uygulama;

CREATE FUNCTION rol_atamasi_tanim_kontrolu() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM rol WHERE kimlik = NEW.rol_ref AND NOT katalog_rolu AND (sahip_rol_ref IS NULL OR nullif(trim(is_amaci), '') IS NULL)) THEN
    RAISE EXCEPTION 'Sahibi ve iş amacı tanımlanmamış role atama yapılamaz';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER rol_atamasi_tanim_kontrolu BEFORE INSERT ON rol_atamasi FOR EACH ROW EXECUTE FUNCTION rol_atamasi_tanim_kontrolu();
