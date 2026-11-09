-- YG-974 zimmet beyanı; YG-956 nöbet sonrası düzen; YG-947 evlilik tarihi rızası.
CREATE TABLE personel_zimmet (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), personel_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), ekipman text NOT NULL CHECK (length(trim(ekipman)) > 0), seri_no text, teslim_tarihi date NOT NULL, beyan_zamani timestamptz NOT NULL DEFAULT now(), iade_zamani timestamptz, iade_alan_ref text REFERENCES kullanici_hesabi (kimlik)
);
CREATE INDEX personel_zimmet_kisi ON personel_zimmet (personel_ref);
CREATE TABLE nobet_serbest_zaman (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), personel_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), nobet_tarihi date NOT NULL, duzen text NOT NULL CHECK (duzen IN ('Geç Başlama', 'Serbest Zaman')), uygulama_tarihi date NOT NULL, aciklama text, amir_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), olusturma_zamani timestamptz NOT NULL DEFAULT now(), UNIQUE (personel_ref, nobet_tarihi)
);
CREATE TABLE personel_ozel_gun (
  personel_ref text PRIMARY KEY REFERENCES kullanici_hesabi (kimlik), evlilik_tarihi date, paylasim_rizasi boolean NOT NULL DEFAULT false, guncelleme_zamani timestamptz NOT NULL DEFAULT now(), CHECK (paylasim_rizasi OR evlilik_tarihi IS NULL)
);
GRANT SELECT, INSERT, UPDATE ON personel_zimmet, nobet_serbest_zaman, personel_ozel_gun TO yatonet_uygulama;
