-- YG-051, YG-052: Saha Sorumlusu talebi ve geri çekme onayı.
CREATE TABLE saha_sorumlusu_talebi (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dosya_ref uuid NOT NULL REFERENCES dosya (kimlik),
  tur text NOT NULL CHECK (tur IN ('Atama', 'Geri Çekme')),
  gerekce text NOT NULL,
  durum text NOT NULL DEFAULT 'Bekliyor' CHECK (durum IN ('Bekliyor', 'Onaylandı', 'Reddedildi', 'Direktörde')),
  karar_makami text,
  talep_eden_ref text NOT NULL,
  olusturma_zamani timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON saha_sorumlusu_talebi (dosya_ref);
GRANT SELECT, INSERT, UPDATE ON saha_sorumlusu_talebi TO yatonet_uygulama;
