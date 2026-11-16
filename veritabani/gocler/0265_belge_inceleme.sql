-- YG-1440: teknik personel belgeyi Uygun / Eksik olarak işaretler.
ALTER TABLE belge ADD COLUMN inceleme_sonucu text CHECK (inceleme_sonucu IN ('Uygun', 'Eksik')), ADD COLUMN inceleme_notu text, ADD COLUMN inceleyen_ref text REFERENCES kullanici_hesabi (kimlik), ADD COLUMN inceleme_zamani timestamptz;
