-- YG-1526: satır başına ertelenmiş denetim toplu yüklemeyi yavaşlattığı için tekillik deyim sonunda tek sorguyla denetlenir.
DROP TRIGGER marka_kodu_tekil ON yat_marka_model;
CREATE OR REPLACE FUNCTION marka_kodu_tekil() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM yat_marka_model GROUP BY lower(marka) HAVING count(DISTINCT marka_kodu) > 1)
     OR EXISTS (SELECT 1 FROM yat_marka_model GROUP BY marka_kodu HAVING count(DISTINCT lower(marka)) > 1) THEN
    RAISE EXCEPTION 'Marka kodu ve marka adı bire bir olmalıdır.' USING ERRCODE = '23505';
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER marka_kodu_tekil AFTER INSERT OR UPDATE OF marka_kodu, marka ON yat_marka_model FOR EACH STATEMENT EXECUTE FUNCTION marka_kodu_tekil();
