-- YG-533: firma ekipmanı bakım ve kalibrasyon geçerliliği. YG-1472: arife yarım gün; takvim yıllık parametredir.
CREATE TABLE firma_ekipmani (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), kurulus_ref uuid NOT NULL REFERENCES kurulus (kimlik), ad text NOT NULL, seri_no text NOT NULL, bakim_bitis date, kalibrasyon_bitis date, kullanilabilir boolean NOT NULL DEFAULT true, kaydeden_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), zaman timestamptz NOT NULL DEFAULT now(), UNIQUE (kurulus_ref, seri_no)
);
ALTER TABLE resmi_tatil ADD COLUMN yarim_gun boolean NOT NULL DEFAULT false, ADD COLUMN giren_ref text REFERENCES kullanici_hesabi (kimlik), ADD COLUMN zaman timestamptz NOT NULL DEFAULT now();
GRANT SELECT, INSERT, UPDATE ON firma_ekipmani TO yatonet_uygulama; GRANT INSERT, UPDATE, DELETE ON resmi_tatil TO yatonet_uygulama;
