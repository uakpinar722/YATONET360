-- YG-1594: K4 tek kaynak bağımlılığında ikinci kaynak planı ve muadil liste Mart/Eylül gözden geçirme kaydı.
CREATE TABLE ikinci_kaynak_plani (uretici_parca_no text PRIMARY KEY, plan text NOT NULL, kaydeden_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), zaman timestamptz NOT NULL DEFAULT now());
CREATE TABLE muadil_gozden_gecirme (donem text PRIMARY KEY, aciklama text NOT NULL, yapan_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), zaman timestamptz NOT NULL DEFAULT now());
GRANT SELECT, INSERT, UPDATE ON ikinci_kaynak_plani TO yatonet_uygulama;
GRANT SELECT, INSERT ON muadil_gozden_gecirme TO yatonet_uygulama;
