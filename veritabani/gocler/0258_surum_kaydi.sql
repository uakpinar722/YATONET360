-- YG-1413, YG-1141: yazılım sürüm kaydı.
CREATE TABLE yazilim_surumu (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  surum text NOT NULL UNIQUE, notlar text NOT NULL, acil boolean NOT NULL DEFAULT false,
  degisiklik_bileti_ref uuid REFERENCES degisiklik_bileti (kimlik),
  duyuru_ref uuid REFERENCES duyuru (kimlik),
  sonradan_onay text CHECK (sonradan_onay IN ('Onay Bekliyor', 'Onaylandı', 'Reddedildi')),
  yayimlayan_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), zaman timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON yazilim_surumu TO yatonet_uygulama;
