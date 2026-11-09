-- YG-1619, YG-1683: idari talep; ihtiyaç onayı silsileyle, parasal onay sipariş aşamasında. YG-1677: CEO masraf fişi silinemez.
CREATE TABLE idari_talep (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), talep_no text NOT NULL UNIQUE, talep_eden_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), konu text NOT NULL CHECK (length(trim(konu)) > 0), gerekce text NOT NULL CHECK (length(trim(gerekce)) > 0),
  durum text NOT NULL DEFAULT 'İhtiyaç Onayında' CHECK (durum IN ('İhtiyaç Onayında', 'İdari İşlerde', 'Sipariş Onayında', 'Sipariş Onaylandı', 'Reddedildi', 'İade Edildi')), tedarikci text, siparis_tutar_eur numeric(14,2) CHECK (siparis_tutar_eur > 0), hazirlayan_ref text REFERENCES kullanici_hesabi (kimlik), olusturma_zamani timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON idari_talep TO yatonet_uygulama;
CREATE OR REPLACE FUNCTION ceo_masraf_silinmez() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM rol_atamasi a JOIN rol r ON r.kimlik = a.rol_ref WHERE a.kullanici_ref = OLD.personel_ref AND r.rol_adi = 'CEO') THEN RAISE EXCEPTION 'CEO masraf fişi silinemez'; END IF;
  RETURN OLD;
END $$;
DROP TRIGGER IF EXISTS ceo_masraf_silinmez ON personel_masraf_fisi;
CREATE TRIGGER ceo_masraf_silinmez BEFORE DELETE ON personel_masraf_fisi FOR EACH ROW EXECUTE FUNCTION ceo_masraf_silinmez();
