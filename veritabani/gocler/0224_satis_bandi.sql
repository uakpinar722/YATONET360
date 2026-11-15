-- YG-233: kartelalı kalemde satış fiyatı aralığı.
ALTER TABLE fiyat_teklifi_kalemi ADD COLUMN bant_alt_eur numeric(14,2), ADD COLUMN bant_ust_eur numeric(14,2);
