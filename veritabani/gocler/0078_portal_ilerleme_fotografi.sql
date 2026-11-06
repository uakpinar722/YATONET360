-- YG-458: yat sahibi portalında yalnız LGM'nin onayladığı ilerleme fotoğrafları görünür; firma adı ve dosya adı gösterilmez.
CREATE TABLE IF NOT EXISTS portal_ilerleme_fotografi (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), dosya_ref uuid NOT NULL REFERENCES dosya (kimlik), surum_ref uuid NOT NULL REFERENCES belge_surum (kimlik), aciklama text NOT NULL CHECK (length(trim(aciklama)) > 0),
  onaylayan_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), onay_zamani timestamptz NOT NULL DEFAULT now(), kaldiran_ref text REFERENCES kullanici_hesabi (kimlik), kaldirma_zamani timestamptz,
  UNIQUE (dosya_ref, surum_ref)
);
GRANT SELECT, INSERT, UPDATE ON portal_ilerleme_fotografi TO yatonet_uygulama;
