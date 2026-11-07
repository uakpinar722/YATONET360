-- YG-089: yat kabul ve teslim tutanağı imzadan (kayıttan/teslimden) sonra değişmez; değişiklik tarihli ek kayıtla yapılır. Görevli firmaya teslimde firma zorunlu.
ALTER TABLE yat_kabul_tutanagi ADD COLUMN IF NOT EXISTS kurulus_ref uuid REFERENCES kurulus (kimlik);
CREATE TABLE IF NOT EXISTS tutanak_ek_kaydi (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), tutanak_turu text NOT NULL CHECK (tutanak_turu IN ('Yat Kabul Tutanağı', 'Teslim Tutanağı')), tutanak_ref uuid NOT NULL, dosya_ref uuid NOT NULL REFERENCES dosya (kimlik),
  metin text NOT NULL CHECK (length(trim(metin)) > 0), giren_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), olusturma_zamani timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tutanak_ek_ref ON tutanak_ek_kaydi (tutanak_ref);
CREATE OR REPLACE FUNCTION tutanak_degismez() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'yat_kabul_tutanagi' THEN
    RAISE EXCEPTION 'Tutanak değiştirilemez; ek kayıt giriniz';
  ELSIF OLD.durum LIKE 'Teslim Edildi%' AND (TG_OP = 'DELETE' OR NEW.teslim_alan IS DISTINCT FROM OLD.teslim_alan OR NEW.alici_turu IS DISTINCT FROM OLD.alici_turu OR NEW.karar IS DISTINCT FROM OLD.karar OR NEW.cekince IS DISTINCT FROM OLD.cekince OR NEW.foto_belge_ref IS DISTINCT FROM OLD.foto_belge_ref OR NEW.teslim_zamani IS DISTINCT FROM OLD.teslim_zamani) THEN
    RAISE EXCEPTION 'Tutanak değiştirilemez; ek kayıt giriniz';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;
DROP TRIGGER IF EXISTS yat_kabul_degismez ON yat_kabul_tutanagi;
CREATE TRIGGER yat_kabul_degismez BEFORE UPDATE OR DELETE ON yat_kabul_tutanagi FOR EACH ROW EXECUTE FUNCTION tutanak_degismez();
DROP TRIGGER IF EXISTS teslim_degismez ON teslim_kaydi;
CREATE TRIGGER teslim_degismez BEFORE UPDATE OR DELETE ON teslim_kaydi FOR EACH ROW EXECUTE FUNCTION tutanak_degismez();
GRANT SELECT, INSERT ON tutanak_ek_kaydi TO yatonet_uygulama;
