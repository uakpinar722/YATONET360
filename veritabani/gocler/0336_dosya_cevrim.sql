-- YG-080: kapat-aç ile süre iyileştirmesini önlemek için çevrim sayacı ve ilk kapanış zamanı (yeniden açmada korunur).
ALTER TABLE dosya ADD COLUMN cevrim integer NOT NULL DEFAULT 1 CHECK (cevrim >= 1), ADD COLUMN ilk_kapanis_zamani timestamptz;
