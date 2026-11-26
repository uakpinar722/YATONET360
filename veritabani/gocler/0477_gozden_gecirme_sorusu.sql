-- YG-599, YG-1363, TZ-5 (CEO 26.11.2026): periyodik gözden geçirmede ortak maddelere ek türe özgü 3–5 soru; Kalite Müdürü onaylayınca kullanılır, düzenlenebilir.
CREATE TABLE gozden_gecirme_sorusu (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  periyodik_ad text NOT NULL, soru text NOT NULL, sira integer NOT NULL,
  onayli boolean NOT NULL DEFAULT false, onaylayan_ref text REFERENCES kullanici_hesabi (kimlik), onay_zamani timestamptz, aktif boolean NOT NULL DEFAULT true,
  UNIQUE (periyodik_ad, soru)
);
GRANT SELECT, INSERT, UPDATE ON gozden_gecirme_sorusu TO yatonet_uygulama;
