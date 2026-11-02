-- Parola sıfırlama (YG-1156) ve adres bazlı deneme sınırı için dizin (YG-1157).
CREATE TABLE parola_sifirlama (
  kimlik            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  olusturma_zamani  timestamptz NOT NULL DEFAULT now(),
  kullanici_ref     text NOT NULL REFERENCES kullanici_hesabi (kimlik),
  belirtec_ozeti    text NOT NULL UNIQUE,
  son_gecerlilik    timestamptz NOT NULL,
  kullanilma_zamani timestamptz
);
CREATE INDEX parola_sifirlama_kisi ON parola_sifirlama (kullanici_ref, olusturma_zamani DESC);
CREATE INDEX denetim_izi_adres ON denetim_izi (kaynak_adres, olay_zamani DESC) WHERE sonuc = 'Başarısız';
GRANT SELECT, INSERT, UPDATE ON parola_sifirlama TO yatonet_uygulama;
