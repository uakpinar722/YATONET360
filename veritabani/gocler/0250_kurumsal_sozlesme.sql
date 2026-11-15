-- YG-208: onaylı kurumsal tekliften sözleşme kaydı.
ALTER TABLE sozlesme_kaydi ADD COLUMN teklif_ref uuid REFERENCES fiyat_teklifi (kimlik), ADD COLUMN ozel_hukum text;
CREATE UNIQUE INDEX sozlesme_kaydi_teklif ON sozlesme_kaydi (teklif_ref) WHERE teklif_ref IS NOT NULL;
