-- YG-626, K-144: hukuki metin işareti; İngilizce hukuki metnin yeni sürümünü CEO onaylar. İşaret yeni sürüm satırına taşınır.
ALTER TABLE sablon_metni ADD COLUMN hukuki boolean NOT NULL DEFAULT false;
