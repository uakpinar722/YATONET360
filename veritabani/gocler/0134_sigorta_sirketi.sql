-- YG-1557, K-237: sigorta şirketleri tam kurumsal unvanla; TSB Tekne branşı (2026/09 direkt prim) 26 şirket + CEO talimatıyla 5 şirket = 31.
CREATE TABLE sigorta_sirketi (tsb_kodu text PRIMARY KEY, kisa_ad text NOT NULL UNIQUE, tam_unvan text NOT NULL UNIQUE, dayanak text NOT NULL CHECK (dayanak IN ('TSB Tekne', 'CEO Talimatı', 'Yıllık Güncelleme')), mersis_unvani text, mersis_teyit_tarihi date, durum text NOT NULL DEFAULT 'Aktif' CHECK (durum IN ('Aktif', 'Pasif')), guncelleyen_ref text REFERENCES kullanici_hesabi (kimlik), guncelleme_zamani timestamptz NOT NULL DEFAULT now());
INSERT INTO sigorta_sirketi (tsb_kodu, kisa_ad, tam_unvan, dayanak) VALUES
  ('1003', 'Aksigorta', 'Aksigorta A.Ş.', 'TSB Tekne'),
  ('1004', 'Allianz Sigorta', 'Allianz Sigorta A.Ş.', 'TSB Tekne'),
  ('1049', 'Ana Sigorta', 'Ana Sigorta A.Ş.', 'TSB Tekne'),
  ('1005', 'Anadolu Sigorta', 'Anadolu Anonim Türk Sigorta Şirketi', 'TSB Tekne'),
  ('1009', 'Axa Sigorta', 'Axa Sigorta A.Ş.', 'TSB Tekne'),
  ('1025', 'Bereket Sigorta', 'Bereket Sigorta A.Ş.', 'TSB Tekne'),
  ('1012', 'Corpus Sigorta', 'Corpus Sigorta A.Ş.', 'TSB Tekne'),
  ('1036', 'Doğa Sigorta', 'Doğa Sigorta A.Ş.', 'TSB Tekne'),
  ('1017', 'Eureko Sigorta', 'Eureko Sigorta A.Ş.', 'TSB Tekne'),
  ('1038', 'GIG Sigorta', 'GIG Sigorta A.Ş.', 'TSB Tekne'),
  ('1022', 'HDI Sigorta', 'HDI Sigorta A.Ş.', 'TSB Tekne'),
  ('1037', 'Koru Sigorta', 'Koru Sigorta A.Ş.', 'TSB Tekne'),
  ('1027', 'Magdeburger Sigorta', 'Magdeburger Sigorta A.Ş.', 'TSB Tekne'),
  ('1028', 'Mapfre Sigorta', 'Mapfre Sigorta A.Ş.', 'TSB Tekne'),
  ('1052', 'Prive Sigorta', 'Prive Sigorta A.Ş.', 'TSB Tekne'),
  ('1045', 'Quick Sigorta', 'Quick Sigorta A.Ş.', 'TSB Tekne'),
  ('1032', 'Ray Sigorta', 'Ray Sigorta A.Ş.', 'TSB Tekne'),
  ('1018', 'Referans Sigorta', 'Referans Sigorta A.Ş.', 'TSB Tekne'),
  ('1035', 'Sompo Sigorta', 'Sompo Sigorta A.Ş.', 'TSB Tekne'),
  ('1034', 'Şeker Sigorta', 'Şeker Sigorta A.Ş.', 'TSB Tekne'),
  ('1039', 'Türk Nippon Sigorta', 'Türk Nippon Sigorta A.Ş.', 'TSB Tekne'),
  ('1040', 'Türk P&I Sigorta', 'Türk P&I Sigorta A.Ş.', 'TSB Tekne'),
  ('1048', 'Türkiye Katılım Sigorta', 'Türkiye Katılım Sigorta A.Ş.', 'TSB Tekne'),
  ('1020', 'Türkiye Sigorta', 'Türkiye Sigorta A.Ş.', 'TSB Tekne'),
  ('1008', 'Unico Sigorta', 'Unico Sigorta A.Ş.', 'TSB Tekne'),
  ('1043', 'Zurich Sigorta', 'Zurich Sigorta A.Ş.', 'TSB Tekne'),
  ('1013', 'VHV Sigorta', 'VHV Allgemeine Sigorta A.Ş.', 'CEO Talimatı'),
  ('1051', 'Arex Sigorta', 'Arex Sigorta A.Ş.', 'CEO Talimatı'),
  ('1030', 'Neova Katılım Sigorta', 'Neova Katılım Sigorta A.Ş.', 'CEO Talimatı'),
  ('1054', 'Aveon Global Sigorta', 'Aveon Global Sigorta A.Ş.', 'CEO Talimatı'),
  ('1057', 'HDI Katılım Sigorta', 'HDI Katılım Sigorta A.Ş.', 'CEO Talimatı');
GRANT SELECT, INSERT, UPDATE ON sigorta_sirketi TO yatonet_uygulama;
-- Kısa ad veya unvan yazımı (AŞ, A.Ş., Anonim Şirketi; Türkçe karakter farkı) tam unvana çevrilir; listede olmayan ad olduğu gibi kalır.
CREATE OR REPLACE FUNCTION sigorta_unvan_anahtari(t text) RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT btrim(regexp_replace(regexp_replace(tr_norm(coalesce(t, '')), '[.,]', '', 'g'), '\s+(as|anonim sirketi)$', '')) $$;
CREATE OR REPLACE FUNCTION sigortaci_unvan() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE u text;
BEGIN
  IF NEW.sigortaci_adi IS NOT NULL THEN
    SELECT tam_unvan INTO u FROM sigorta_sirketi WHERE sigorta_unvan_anahtari(NEW.sigortaci_adi) IN (sigorta_unvan_anahtari(kisa_ad), sigorta_unvan_anahtari(tam_unvan), sigorta_unvan_anahtari(mersis_unvani)) LIMIT 1;
    IF u IS NOT NULL THEN NEW.sigortaci_adi := u; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER sigortaci_unvan BEFORE INSERT OR UPDATE OF sigortaci_adi ON dosya_sigorta_kaydi FOR EACH ROW EXECUTE FUNCTION sigortaci_unvan();
CREATE TRIGGER sigortaci_unvan BEFORE INSERT OR UPDATE OF sigortaci_adi ON sigorta_ek2_surum FOR EACH ROW EXECUTE FUNCTION sigortaci_unvan();
CREATE TRIGGER sigortaci_unvan BEFORE INSERT OR UPDATE OF sigortaci_adi ON sigorta_kurum_karti FOR EACH ROW EXECUTE FUNCTION sigortaci_unvan();
CREATE TRIGGER sigortaci_unvan BEFORE INSERT OR UPDATE OF sigortaci_adi ON sigorta_mutabakat_raporu FOR EACH ROW EXECUTE FUNCTION sigortaci_unvan();
UPDATE dosya_sigorta_kaydi SET sigortaci_adi = sigortaci_adi WHERE sigortaci_adi IS NOT NULL;
