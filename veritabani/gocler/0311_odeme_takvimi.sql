-- YG-918: ödeme takviminde elle girilen vergi, SGK ve diğer dönemsel ödemeler.
CREATE TABLE odeme_takvimi_kalemi (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), tur text NOT NULL CHECK (tur IN ('Vergi', 'SGK', 'Diğer')), aciklama text NOT NULL CHECK (length(trim(aciklama)) > 0),
  tutar_tl numeric(14,2) CHECK (tutar_tl > 0), vade date NOT NULL, giren_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), olusturma_zamani timestamptz NOT NULL DEFAULT now(),
  odenme_zamani timestamptz, odeyen_ref text REFERENCES kullanici_hesabi (kimlik)
);
GRANT SELECT, INSERT, UPDATE ON odeme_takvimi_kalemi TO yatonet_uygulama;
