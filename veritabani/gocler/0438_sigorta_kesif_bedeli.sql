-- YG-1487: sigorta şirketiyle karşılıklı mutabakatla belirlenen Ek-1 keşif bedeli.
CREATE TABLE sigorta_kesif_bedeli (
  sigortaci_adi text NOT NULL CHECK (length(trim(sigortaci_adi)) > 0), tutar_eur numeric(12,2) NOT NULL CHECK (tutar_eur > 0),
  dayanak text NOT NULL CHECK (length(trim(dayanak)) > 0), giren_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), zaman timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX sigorta_kesif_bedeli_tek ON sigorta_kesif_bedeli (lower(sigortaci_adi));
GRANT SELECT, INSERT, UPDATE ON sigorta_kesif_bedeli TO yatonet_uygulama;
