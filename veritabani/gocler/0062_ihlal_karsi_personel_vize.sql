-- Kişisel Veri Çerçeve m.13.1: karşı tarafa 12 saatte ilk bildirim. D-025: vize ve pasaport bitişi.
ALTER TABLE veri_ihlali ADD COLUMN karsi_taraf text;
ALTER TABLE personel_karti ADD COLUMN vize_bitis date, ADD COLUMN pasaport_bitis date;
