-- Vekâlet (YG-1056, YG-1478, YG-1630), kayıtlı cihaz (YG-1006, YG-1150), çakışan rol (YG-1041, YG-1037).
CREATE TABLE vekalet (
  kimlik           text PRIMARY KEY CHECK (kimlik ~ '^VKL-[0-9]{4}-[0-9]{4,}$'),
  olusturma_zamani timestamptz NOT NULL DEFAULT now(),
  asil_ref         text NOT NULL REFERENCES kullanici_hesabi (kimlik),
  vekil_ref        text NOT NULL REFERENCES kullanici_hesabi (kimlik),
  rol_ref          text NOT NULL REFERENCES rol (kimlik),
  vekalet_nedeni   text NOT NULL CHECK (vekalet_nedeni IN ('İzin', 'Hastalık', 'Görev değişikliği', 'Ayrılık', 'Ulaşım veya olağanüstü durum')),
  kapsam           text NOT NULL CHECK (length(trim(kapsam)) > 0),
  baslangic_tarihi date NOT NULL,
  bitis_tarihi     date NOT NULL,
  atayan_ref       text NOT NULL REFERENCES kullanici_hesabi (kimlik),
  durum            text NOT NULL DEFAULT 'Aktif' CHECK (durum IN ('Aktif', 'Kapalı')),
  kapanis_zamani   timestamptz,
  CHECK (asil_ref <> vekil_ref),
  CHECK (bitis_tarihi >= baslangic_tarihi),
  CHECK (bitis_tarihi - baslangic_tarihi <= 30)
);
CREATE INDEX vekalet_vekil ON vekalet (vekil_ref) WHERE durum = 'Aktif';

ALTER TABLE is_karti_adim ADD COLUMN vekaleten boolean NOT NULL DEFAULT false;

CREATE TABLE cihaz_kaydi (
  kimlik           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  olusturma_zamani timestamptz NOT NULL DEFAULT now(),
  kullanici_ref    text NOT NULL REFERENCES kullanici_hesabi (kimlik),
  belirtec_ozeti   text NOT NULL UNIQUE,
  durum            text NOT NULL CHECK (durum IN ('Onay Bekliyor', 'Onaylı', 'İptal')),
  kaynak_adres     text,
  onaylayan_ref    text REFERENCES kullanici_hesabi (kimlik)
);
CREATE INDEX cihaz_kisi ON cihaz_kaydi (kullanici_ref);

CREATE TABLE rol_cakisma (
  rol_a text NOT NULL REFERENCES rol (kimlik),
  rol_b text NOT NULL REFERENCES rol (kimlik),
  neden text NOT NULL,
  PRIMARY KEY (rol_a, rol_b)
);

GRANT SELECT, INSERT, UPDATE ON vekalet, cihaz_kaydi TO yatonet_uygulama;
GRANT SELECT ON rol_cakisma TO yatonet_uygulama;
