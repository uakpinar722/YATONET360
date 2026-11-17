-- YG-926: pasif taraf işareti; pasif yat sahibiyle yeni dosya açılmaz.
ALTER TABLE taraf ADD COLUMN pasif boolean NOT NULL DEFAULT false, ADD COLUMN pasif_gerekcesi text, ADD COLUMN pasif_yapan_ref text REFERENCES kullanici_hesabi (kimlik), ADD COLUMN pasif_zamani timestamptz;
