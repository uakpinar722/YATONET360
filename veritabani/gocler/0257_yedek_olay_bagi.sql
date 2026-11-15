-- YG-1642: başarısız yedek işinin olay kaydı bağı.
ALTER TABLE yedek_kaydi ADD COLUMN olay_ref uuid REFERENCES olay_kaydi (kimlik);
