-- YG-381: görsel kanıtın iş kalemi bağı.
ALTER TABLE gorsel_kanit ADD COLUMN is_kalemi_ref uuid REFERENCES fiyat_teklifi_kalemi (kimlik);
CREATE INDEX gorsel_kanit_belge_kalem ON gorsel_kanit (belge_ref, is_kalemi_ref);
