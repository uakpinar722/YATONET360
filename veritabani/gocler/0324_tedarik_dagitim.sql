-- YG-1592: onaylı Teknik Malzeme Talebinin (FR-MLZ-001) Tedarik Sorumlusuna dağıtımı.
CREATE TABLE tedarik_dagitim (
  form_ref uuid PRIMARY KEY REFERENCES form_kaydi (kimlik), sorumlu_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik),
  atayan_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), zaman timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON tedarik_dagitim TO yatonet_uygulama;
