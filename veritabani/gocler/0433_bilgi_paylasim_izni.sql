-- YG-1449, ONY-16: yat sahibinin dosya bazında Bilgi Paylaşım İzni.
CREATE TABLE bilgi_paylasim_izni (dosya_ref uuid PRIMARY KEY REFERENCES dosya (kimlik), taraflar text[] NOT NULL DEFAULT '{}', veren_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), zaman timestamptz NOT NULL DEFAULT now());
GRANT SELECT, INSERT, UPDATE ON bilgi_paylasim_izni TO yatonet_uygulama;
