-- YG-196: teknik pay metrajdan ayrı tutulur; ölçülemeyen değer tahmini olarak işaretlenir; seçilmeyen opsiyon ve alternatifler iş emrinde ayrı listelenir.
ALTER TABLE kapsam_satiri ADD COLUMN teknik_pay numeric(14,3) NOT NULL DEFAULT 0 CHECK (teknik_pay >= 0), ADD COLUMN olculemez boolean NOT NULL DEFAULT false;
ALTER TABLE fiyat_teklifi_kalemi ADD COLUMN olculemez boolean NOT NULL DEFAULT false;
ALTER TABLE is_emri_kalemi ADD COLUMN teknik_pay numeric(14,3) NOT NULL DEFAULT 0, ADD COLUMN olculemez boolean NOT NULL DEFAULT false;
ALTER TABLE is_emri ADD COLUMN secilmeyen_kalemler text;
