-- YG-1694: Kritik uygunsuzluk kapanışında Risk ve Kalite Direktörünün kararı (sorumlu birim ve hedef tarih).
ALTER TABLE uygunsuzluk ADD COLUMN direktor_sorumlu_birim text, ADD COLUMN direktor_hedef_tarihi date, ADD COLUMN direktor_karar_notu text, ADD COLUMN direktor_karar_ref text REFERENCES kullanici_hesabi (kimlik), ADD COLUMN direktor_karar_zamani timestamptz;
