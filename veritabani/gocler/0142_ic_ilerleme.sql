-- YG-787: iç ilerleme raporu; fiziksel ve finansal ilerleme ayrı tutulur.
CREATE TABLE ic_ilerleme_raporu (dosya_ref uuid NOT NULL REFERENCES dosya (kimlik), tarih date NOT NULL, fiziksel numeric(5,1), hakedis numeric(5,1), faturalama numeric(5,1), degerlendirme text NOT NULL, hazirlayan_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), zaman timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (dosya_ref, tarih));
GRANT SELECT, INSERT, UPDATE ON ic_ilerleme_raporu TO yatonet_uygulama;
