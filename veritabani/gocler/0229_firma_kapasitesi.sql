-- YG-309: branş, görev sınıfı ve tesis bazında firma kapasitesi; iş emrinde branş ve görev sınıfı.
CREATE TABLE firma_kapasitesi (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kurulus_ref uuid NOT NULL REFERENCES kurulus (kimlik),
  ana_brans text NOT NULL,
  gorev_sinifi text CHECK (gorev_sinifi IN ('G1', 'G2', 'G3', 'G4')),
  tesis_ref uuid REFERENCES firma_tesisi (kimlik),
  es_zamanli_is integer NOT NULL CHECK (es_zamanli_is > 0),
  giren_ref text NOT NULL, olusturma_zamani timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX firma_kapasitesi_tekil ON firma_kapasitesi (kurulus_ref, ana_brans, coalesce(gorev_sinifi, '*'), coalesce(tesis_ref::text, '*'));
GRANT SELECT, INSERT, UPDATE ON firma_kapasitesi TO yatonet_uygulama;
ALTER TABLE is_emri ADD COLUMN ana_brans text, ADD COLUMN gorev_sinifi text;
