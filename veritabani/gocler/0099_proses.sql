-- YG-1455, YG-408, YG-282 (PRS-1): özel proses kayıtları (FR-ONR-005/006, FR-ONR-010 alan olarak); sınırları Teknik Uzman dayanağıyla girer.
CREATE TABLE proses_siniri (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), is_emri_ref uuid NOT NULL REFERENCES is_emri (kimlik), proses_turu text NOT NULL CHECK (proses_turu IN ('Kompozit Laminasyon ve Kür', 'Yapıştırma, Sızdırmazlık ve Dolgu')),
  sicaklik_min numeric(5,1), sicaklik_max numeric(5,1), nem_min numeric(5,1), nem_max numeric(5,1), dayanak text NOT NULL CHECK (length(trim(dayanak)) > 0),
  giren_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), olusturma_zamani timestamptz NOT NULL DEFAULT now(), UNIQUE (is_emri_ref, proses_turu),
  CHECK (coalesce(sicaklik_min, sicaklik_max, nem_min, nem_max) IS NOT NULL), CHECK (sicaklik_min IS NULL OR sicaklik_max IS NULL OR sicaklik_min <= sicaklik_max), CHECK (nem_min IS NULL OR nem_max IS NULL OR nem_min <= nem_max)
);
CREATE TABLE proses_kaydi (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), kayit_no text NOT NULL UNIQUE, dosya_ref uuid NOT NULL REFERENCES dosya (kimlik), is_emri_ref uuid NOT NULL REFERENCES is_emri (kimlik), proses_turu text NOT NULL,
  olusturma_zamani timestamptz NOT NULL DEFAULT now(), UNIQUE (is_emri_ref, proses_turu)
);
CREATE TABLE proses_seansi (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), kayit_ref uuid NOT NULL REFERENCES proses_kaydi (kimlik), seans_no integer NOT NULL, seans_zamani timestamptz NOT NULL,
  sicaklik numeric(5,1) NOT NULL, nem numeric(5,1) NOT NULL CHECK (nem BETWEEN 0 AND 100), recine_kg numeric(8,3), sertlestirici_kg numeric(8,3), kat_sirasi text, vakum_degeri numeric(8,2), vakum_suresi_dk integer, malzeme text, sorumlu_rol text NOT NULL, notlar text,
  sinir_disi text[] NOT NULL DEFAULT '{}', durum text NOT NULL CHECK (durum IN ('Girildi', 'Karar Bekliyor', 'Onaylı', 'Uygun Değil')),
  karar text CHECK (karar IN ('Devam', 'Durdur')), karar_gerekcesi text, karar_veren_ref text REFERENCES kullanici_hesabi (kimlik), karar_zamani timestamptz,
  uygunsuzluk_ref uuid REFERENCES uygunsuzluk (kimlik), onaylayan_ref text REFERENCES kullanici_hesabi (kimlik), onay_zamani timestamptz, giren_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), olusturma_zamani timestamptz NOT NULL DEFAULT now(),
  UNIQUE (kayit_ref, seans_no), CHECK (durum <> 'Uygun Değil' OR uygunsuzluk_ref IS NOT NULL), CHECK (durum <> 'Onaylı' OR (onaylayan_ref IS NOT NULL AND onay_zamani IS NOT NULL))
);
GRANT SELECT, INSERT, UPDATE ON proses_siniri, proses_kaydi, proses_seansi TO yatonet_uygulama;
