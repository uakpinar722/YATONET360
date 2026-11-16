-- YG-090: yat sicil bilgisi tekillik anahtarıdır (gövde no ve IMO gibi).
CREATE UNIQUE INDEX yat_sicil ON yat (lower(trim(sicil_bilgisi))) WHERE sicil_bilgisi IS NOT NULL AND trim(sicil_bilgisi) <> '';
