-- YG-1261: firma ilçe bilgisinin teyit işareti.
ALTER TABLE kurulus ADD COLUMN ilce_teyit_zamani timestamptz, ADD COLUMN ilce_teyit_kaynagi text, ADD COLUMN ilce_teyit_eden_ref text REFERENCES kullanici_hesabi (kimlik);
