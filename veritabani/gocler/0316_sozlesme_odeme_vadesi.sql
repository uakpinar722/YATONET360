-- YG-900: sigorta şirketinin belirlediği ödeme günü (fatura tarihinden en çok 30 takvim günü) ve kurumsal müşteri sözleşme vadesi.
CREATE TABLE sozlesme_odeme_vadesi (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sigortaci_adi text, kurum_ref uuid REFERENCES kurumsal_kurum (kimlik),
  gun integer NOT NULL CHECK (gun BETWEEN 0 AND 180),
  dayanak text NOT NULL CHECK (length(trim(dayanak)) > 0),
  giren_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), zaman timestamptz NOT NULL DEFAULT now(),
  CHECK ((sigortaci_adi IS NULL) <> (kurum_ref IS NULL)),
  CHECK (sigortaci_adi IS NULL OR gun BETWEEN 1 AND 30)
);
CREATE UNIQUE INDEX sozlesme_odeme_vadesi_tek ON sozlesme_odeme_vadesi (coalesce(lower(sigortaci_adi), kurum_ref::text));
GRANT SELECT, INSERT, UPDATE ON sozlesme_odeme_vadesi TO yatonet_uygulama;
