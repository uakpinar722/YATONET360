-- YG-709: teklifte 013 ön koşul ve durdurma noktası maddeleri (Hariç / Ayrıca Fiyatlandırılır).
CREATE TABLE teklif_maddesi (
  teklif_ref uuid NOT NULL REFERENCES fiyat_teklifi (kimlik), madde text NOT NULL, tur text NOT NULL CHECK (tur IN ('Hariç', 'Ayrıca Fiyatlandırılır')),
  giren_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), zaman timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (teklif_ref, madde)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON teklif_maddesi TO yatonet_uygulama;
