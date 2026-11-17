-- YG-1867: teslim alınmayan yatın barınma gideri tutarı Ticari Sorumluca elle girilir.
ALTER TABLE dosya ADD COLUMN barinma_gideri_eur numeric(14,2) CHECK (barinma_gideri_eur >= 0), ADD COLUMN barinma_gideri_giren_ref text REFERENCES kullanici_hesabi (kimlik), ADD COLUMN barinma_gideri_zamani timestamptz;
-- YG-885: proformanın muhasebeye iletildiği an (48 saatte fatura izlemesi).
ALTER TABLE musteri_faturasi ADD COLUMN muhasebe_iletim_zamani timestamptz;
