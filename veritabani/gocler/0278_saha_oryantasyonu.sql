-- YG-938: Çözüm Ortağı personeline saha oryantasyonu.
ALTER TABLE akademi_ders DROP CONSTRAINT IF EXISTS akademi_ders_tur_check;
ALTER TABLE akademi_ders ADD CONSTRAINT akademi_ders_tur_check CHECK (tur IN ('Zorunlu', 'Oryantasyon', 'Rol Müfredatı', 'Saha Oryantasyonu'));
CREATE TABLE firma_oryantasyon (
  ders_ref uuid NOT NULL REFERENCES akademi_ders (kimlik), surum integer NOT NULL, personel_ref uuid NOT NULL REFERENCES firma_personeli (kimlik),
  beyan_eden_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), zaman timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (ders_ref, surum, personel_ref)
);
GRANT SELECT, INSERT ON firma_oryantasyon TO yatonet_uygulama;
