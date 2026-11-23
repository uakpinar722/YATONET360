-- YG-534, YG-804: 14 gün kala derlenen gözden geçirme paketi.
CREATE TABLE gozden_gecirme_paketi (periyodik_ref uuid NOT NULL REFERENCES periyodik_is (kimlik), donem_tarihi date NOT NULL, tur text NOT NULL, icerik jsonb NOT NULL, zaman timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (periyodik_ref, donem_tarihi));
GRANT SELECT, INSERT, UPDATE ON gozden_gecirme_paketi TO yatonet_uygulama;
