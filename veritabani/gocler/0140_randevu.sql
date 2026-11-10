-- YG-552: randevu bildirimi (BLD-19–22) ve takvim daveti kaydı.
CREATE TABLE randevu_bildirimi (kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), dosya_ref uuid NOT NULL REFERENCES dosya (kimlik), tur text NOT NULL CHECK (tur IN ('Keşif', 'Garanti Keşfi', 'Tanıklık', 'Deniz Denemesi')), bld_kodu text NOT NULL, randevu_zamani timestamptz NOT NULL, yer text NOT NULL, is_test text, davet_surum_ref uuid REFERENCES belge_surum (kimlik), alici_sayisi integer NOT NULL DEFAULT 0, olusturan_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), olusturma_zamani timestamptz NOT NULL DEFAULT now());
CREATE INDEX randevu_bildirimi_dosya ON randevu_bildirimi (dosya_ref);
GRANT SELECT, INSERT, UPDATE ON randevu_bildirimi TO yatonet_uygulama;
