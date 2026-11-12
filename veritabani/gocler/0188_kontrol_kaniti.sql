-- YG-613: kutunun işaretlenmesi kanıtın varlığı ve kontrolü sayılmaz; kanıt tanımlı maddede belge ve kontrol eden kaydı.
ALTER TABLE kontrol_listesi_maddesi ADD COLUMN kanit_tanimi text, ADD COLUMN kanit_kontrol_eden_ref text REFERENCES kullanici_hesabi (kimlik), ADD COLUMN kanit_kontrol_zamani timestamptz;
