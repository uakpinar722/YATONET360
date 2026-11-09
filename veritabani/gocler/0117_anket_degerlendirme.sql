-- YG-1470, YG-1475: memnuniyet anketi. YG-962, YG-971: üç aylık görüşme ve yıllık değerlendirme.
CREATE TABLE memnuniyet_anketi (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), dosya_ref uuid NOT NULL UNIQUE REFERENCES dosya (kimlik), belirtec_ozet text NOT NULL UNIQUE, dil text NOT NULL, gonderim_zamani timestamptz NOT NULL DEFAULT now(), cevap_zamani timestamptz, genel integer CHECK (genel BETWEEN 1 AND 5), iletisim integer CHECK (iletisim BETWEEN 1 AND 5), is_kalitesi integer CHECK (is_kalitesi BETWEEN 1 AND 5), yorum text, ortalama numeric(3,2), gorusme_sonucu text, gorusen_ref text REFERENCES kullanici_hesabi (kimlik)
);
CREATE TABLE personel_degerlendirme (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), personel_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), tur text NOT NULL CHECK (tur IN ('Üç Aylık', 'Yıllık')), donem text NOT NULL, gorusme_tarihi date NOT NULL, notlar text NOT NULL CHECK (length(trim(notlar)) > 0), egitim_ihtiyaci text, amir_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), zaman timestamptz NOT NULL DEFAULT now(), UNIQUE (personel_ref, tur, donem), CHECK (tur <> 'Yıllık' OR length(trim(coalesce(egitim_ihtiyaci, ''))) > 0)
);
GRANT SELECT, INSERT, UPDATE ON memnuniyet_anketi TO yatonet_uygulama;
GRANT SELECT, INSERT ON personel_degerlendirme TO yatonet_uygulama;
