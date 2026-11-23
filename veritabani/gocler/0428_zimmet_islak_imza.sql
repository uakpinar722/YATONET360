-- YG-223: sistem erişimi olmayan personelde zimmet ıslak imzalı taranmış belgeyle kaydedilir.
ALTER TABLE personel_zimmet ADD COLUMN islak_imzali_belge_ref uuid REFERENCES belge (kimlik), ADD COLUMN kaydeden_ref text REFERENCES kullanici_hesabi (kimlik);
