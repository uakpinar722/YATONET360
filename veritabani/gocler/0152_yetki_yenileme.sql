-- YG-1573: acente/broker yenilenmiş yetki belgesi yüklemesi; Dosya Sorumlusu doğrular.
CREATE TABLE yetki_yenileme (kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), yetki_ref uuid NOT NULL REFERENCES yetki_kaydi (kimlik), belge_ref uuid NOT NULL REFERENCES belge (kimlik), beyan_bitis date, durum text NOT NULL DEFAULT 'Kontrolde' CHECK (durum IN ('Kontrolde', 'Kabul', 'Ret')), yukleyen_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), zaman timestamptz NOT NULL DEFAULT now());
GRANT SELECT, INSERT, UPDATE ON yetki_yenileme TO yatonet_uygulama;
