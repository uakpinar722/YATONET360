-- YG-264: olay yöneticisinin devralması ve süreklilik seviyesi.
ALTER TABLE olay_kaydi ADD COLUMN olay_yoneticisi_ref text REFERENCES kullanici_hesabi (kimlik), ADD COLUMN devralma_zamani timestamptz, ADD COLUMN sureklilik_seviyesi text, ADD COLUMN seviye_zamani timestamptz;
