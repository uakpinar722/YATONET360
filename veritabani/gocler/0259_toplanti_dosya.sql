-- YG-1408: toplantının ve kararın dosya bağı.
ALTER TABLE toplanti ADD COLUMN dosya_ref uuid REFERENCES dosya (kimlik);
ALTER TABLE toplanti_karar ADD COLUMN dosya_ref uuid REFERENCES dosya (kimlik);
