-- YG-072: dosya kilometre taşı; baz tarih silinmez ve değişmez; baz aşılınca gecikme nedeni, azaltıcı eylem ve sonraki etki zorunludur.
CREATE TABLE IF NOT EXISTS kilometre_tasi (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), dosya_ref uuid NOT NULL REFERENCES dosya (kimlik), ad text NOT NULL CHECK (length(trim(ad)) > 0), baz_tarih date NOT NULL, guncel_tarih date NOT NULL,
  gerceklesme_tarihi date, gecikme_nedeni text, azaltici_eylem text, sonraki_etki text, giren_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), olusturma_zamani timestamptz NOT NULL DEFAULT now(),
  CHECK (guncel_tarih <= baz_tarih OR (gecikme_nedeni IS NOT NULL AND azaltici_eylem IS NOT NULL AND sonraki_etki IS NOT NULL))
);
CREATE OR REPLACE FUNCTION kilometre_baz_korur() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Kilometre taşı silinemez'; END IF;
  IF NEW.baz_tarih <> OLD.baz_tarih THEN RAISE EXCEPTION 'Baz tarih değiştirilemez'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS kilometre_baz ON kilometre_tasi;
CREATE TRIGGER kilometre_baz BEFORE UPDATE OR DELETE ON kilometre_tasi FOR EACH ROW EXECUTE FUNCTION kilometre_baz_korur();
GRANT SELECT, INSERT, UPDATE ON kilometre_tasi TO yatonet_uygulama;
