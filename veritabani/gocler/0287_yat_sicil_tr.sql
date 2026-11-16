-- YG-090: sicil tekilliği Türkçe büyük/küçük harf farkından bağımsız (I/ı/İ/i) karşılaştırılır.
DROP INDEX IF EXISTS yat_sicil;
CREATE UNIQUE INDEX yat_sicil ON yat (tr_norm(trim(sicil_bilgisi))) WHERE sicil_bilgisi IS NOT NULL AND trim(sicil_bilgisi) <> '';
