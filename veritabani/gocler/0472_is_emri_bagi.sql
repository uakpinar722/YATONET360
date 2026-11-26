-- YG-384, YG-004 (PKT-1, CEO 09.11.2026: iş paketi = iş emri): ölçüm, test, sökülen parça ve tedarik siparişi ilgili iş emrine bağlanır.
ALTER TABLE olcum_kaydi ADD COLUMN is_emri_ref uuid REFERENCES is_emri (kimlik);
ALTER TABLE test_kaydi ADD COLUMN is_emri_ref uuid REFERENCES is_emri (kimlik);
ALTER TABLE sokulen_parca ADD COLUMN is_emri_ref uuid REFERENCES is_emri (kimlik);
ALTER TABLE tedarik_siparisi ADD COLUMN is_emri_ref uuid REFERENCES is_emri (kimlik);
CREATE INDEX ON olcum_kaydi (is_emri_ref); CREATE INDEX ON test_kaydi (is_emri_ref); CREATE INDEX ON sokulen_parca (is_emri_ref); CREATE INDEX ON tedarik_siparisi (is_emri_ref);
