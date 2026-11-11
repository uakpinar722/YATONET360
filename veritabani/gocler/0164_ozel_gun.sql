-- YG-1633, YG-1711: doğum günü yalnız gün-ay olarak ve rıza veren personelce girilir; yıl tutulmaz.
ALTER TABLE personel_karti ADD COLUMN dogum_gunu text CHECK (dogum_gunu ~ '^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$');
