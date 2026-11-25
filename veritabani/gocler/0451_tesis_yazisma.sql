-- YG-1447: Dosya Sorumlusunun firmadan veya tesisten gelen yazışmayı tesis işlemine hızlı girişi (ek, durum, yeni hedef tarih).
CREATE TABLE tesis_talebi_yazisma (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), talep_ref uuid NOT NULL REFERENCES tesis_talebi (kimlik), kaynak text NOT NULL CHECK (kaynak IN ('Firma', 'Tesis')), ozet text NOT NULL,
  durum text NOT NULL, eski_hedef date, yeni_hedef date, belge_ref uuid REFERENCES belge (kimlik), giren_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), zaman timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX tesis_talebi_yazisma_talep ON tesis_talebi_yazisma (talep_ref, zaman);
GRANT SELECT, INSERT ON tesis_talebi_yazisma TO yatonet_uygulama;
