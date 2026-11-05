-- YG-161: onay kaydında temsil edilen sıfat, yetki dayanağı ve tutar.
ALTER TABLE yatonet_onay_kaydi ADD COLUMN temsil_sifati text, ADD COLUMN yetki_dayanagi text, ADD COLUMN tutar_eur numeric(14,2);
