-- YG-055: keşif planını Teknik Uzman hazırlar, Teknik Yönetici onaylar; Kritik dosyada onay beklenmez.
ALTER TABLE kesif ADD COLUMN IF NOT EXISTS plan_onaylayan_ref text REFERENCES kullanici_hesabi (kimlik), ADD COLUMN IF NOT EXISTS plan_onay_zamani timestamptz;
-- Mevcut keşifler onaylı sayılır.
UPDATE kesif SET plan_onay_zamani = olusturma_zamani WHERE plan_onay_zamani IS NULL;
