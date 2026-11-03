-- YG-1458: %80 eşiğinde sigortalı dosyada sigorta kararına kadar yeni kalem eklenmez; oran ve değer burada da tutulmaz.
ALTER TABLE dosya ADD COLUMN IF NOT EXISTS ekonomik_kilit boolean NOT NULL DEFAULT false, ADD COLUMN IF NOT EXISTS ekonomik_karar text CHECK (ekonomik_karar IN ('Devam', 'Onarım Yapılmayacak')), ADD COLUMN IF NOT EXISTS ekonomik_karar_zamani timestamptz;
