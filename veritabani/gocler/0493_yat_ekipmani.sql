-- YG-001, YG-004 (V-1124): yat ekipmanı tekil kimlikle kaydedilir; bulgu, sökülen parça ve iş emri kalemi ekipmana bağlanır.
CREATE TABLE yat_ekipmani (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), yat_ref uuid NOT NULL REFERENCES yat (kimlik), ekipman_no text NOT NULL,
  sistem text NOT NULL CHECK (length(trim(sistem)) > 0), ad text NOT NULL CHECK (length(trim(ad)) > 0), marka text, model text, seri_no text, konum text,
  kaydeden_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), olusturma_zamani timestamptz NOT NULL DEFAULT now(), birlestirilen_ana_ref uuid,
  UNIQUE (yat_ref, ekipman_no)
);
CREATE UNIQUE INDEX yat_ekipmani_seri ON yat_ekipmani (yat_ref, lower(seri_no)) WHERE seri_no IS NOT NULL;
GRANT SELECT, INSERT, UPDATE ON yat_ekipmani TO yatonet_uygulama;
ALTER TABLE bulgu ADD COLUMN ekipman_ref uuid REFERENCES yat_ekipmani (kimlik);
ALTER TABLE sokulen_parca ADD COLUMN ekipman_ref uuid REFERENCES yat_ekipmani (kimlik);
ALTER TABLE is_emri_kalemi ADD COLUMN ekipman_ref uuid REFERENCES yat_ekipmani (kimlik);
