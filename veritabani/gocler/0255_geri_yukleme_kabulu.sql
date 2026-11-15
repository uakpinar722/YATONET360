-- YG-1278: tam geri yükleme testi sonucunun onay zinciri ve son kabulü.
ALTER TABLE geri_yukleme_testi ADD COLUMN kabul text CHECK (kabul IN ('Onay Bekliyor', 'Kabul Edildi', 'Reddedildi')), ADD COLUMN kabul_zamani timestamptz;
