-- YG-1424: itirazda gerekirse bağımsız sörveyör kaydı; kayıt başına tek açık sörveyör.
CREATE TABLE garanti_sikayet_sorveyor (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), kayit_ref uuid NOT NULL REFERENCES garanti_sikayet (kimlik),
  sorveyor_adi text NOT NULL CHECK (length(trim(sorveyor_adi)) > 0), kurum text, iletisim text, gerekce text NOT NULL CHECK (length(trim(gerekce)) > 0),
  atayan_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), zaman timestamptz NOT NULL DEFAULT now(),
  rapor_tarihi date, sonuc text, sonuc_giren_ref text REFERENCES kullanici_hesabi (kimlik)
);
CREATE UNIQUE INDEX garanti_sorveyor_acik ON garanti_sikayet_sorveyor (kayit_ref) WHERE sonuc IS NULL;
GRANT SELECT, INSERT ON garanti_sikayet_sorveyor TO yatonet_uygulama;
GRANT UPDATE (rapor_tarihi, sonuc, sonuc_giren_ref) ON garanti_sikayet_sorveyor TO yatonet_uygulama;
