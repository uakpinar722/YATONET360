-- YG-1053: dış tarafın çalışan ayrılış/görev değişikliği bildirimi.
CREATE TABLE dis_ayrilis_bildirimi (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kullanici_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik),
  tur text NOT NULL CHECK (tur IN ('Ayrılış', 'Görev Değişikliği')),
  kanal text NOT NULL CHECK (kanal IN ('Portal', 'E-posta', 'Telefon', 'Yazı')),
  bildirim_zamani timestamptz NOT NULL, kapatma_zamani timestamptz NOT NULL DEFAULT now(),
  aciklama text, kaydeden_ref text NOT NULL
);
GRANT SELECT, INSERT ON dis_ayrilis_bildirimi TO yatonet_uygulama;
