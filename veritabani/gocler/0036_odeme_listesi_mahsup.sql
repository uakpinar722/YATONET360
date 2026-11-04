-- YG-830 ödeme listesi; YG-833 acil istisna; YG-840, YG-1418, YG-353 hakediş mahsubu; YG-841 açık iş bedeli; YG-842 malzeme avansı; YG-846 firma faturası tarih ve kuru; YG-827, YG-828 görev ayrılığı.
CREATE TABLE odeme_listesi (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), liste_no text NOT NULL UNIQUE, durum text NOT NULL DEFAULT 'Onayda' CHECK (durum IN ('Onayda', 'Onaylandı', 'Reddedildi', 'Tamamlandı')), mukerrerlik_cozumu text, hazirlayan_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), olusturma_zamani timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE firma_malzeme_avansi (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), is_emri_ref uuid NOT NULL REFERENCES is_emri (kimlik), dosya_ref uuid NOT NULL REFERENCES dosya (kimlik), kurulus_ref uuid NOT NULL REFERENCES kurulus (kimlik), tutar_eur numeric(14,2) NOT NULL CHECK (tutar_eur > 0), gerekce text NOT NULL, durum text NOT NULL DEFAULT 'Onayda' CHECK (durum IN ('Onayda', 'Onaylandı', 'Reddedildi', 'Ödendi')), hazirlayan_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), olusturma_zamani timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE hakedis_mahsubu (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), kurulus_ref uuid NOT NULL REFERENCES kurulus (kimlik), dosya_ref uuid NOT NULL REFERENCES dosya (kimlik), tur text NOT NULL CHECK (tur IN ('Garanti Masrafı', 'Başka Firmaya Verilen Zarar', 'Çevre Cezası', 'Kusur Cezası', 'Temizlik Bedeli', 'İşi Bırakma Maliyet Farkı', 'Malzeme Avansı')), tutar_eur numeric(14,2) NOT NULL CHECK (tutar_eur > 0), kalan_eur numeric(14,2) NOT NULL DEFAULT 0, belge_ref uuid REFERENCES belge (kimlik), aciklama text NOT NULL, statu text NOT NULL DEFAULT 'Onayda' CHECK (statu IN ('Onayda', 'Onaylandı', 'Reddedildi')), hazirlayan_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), olusturma_zamani timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX hakedis_mahsubu_firma ON hakedis_mahsubu (kurulus_ref) WHERE kalan_eur > 0;
ALTER TABLE odeme_talimati DROP CONSTRAINT odeme_talimati_hakedis_ref_key, ALTER COLUMN hakedis_ref DROP NOT NULL, ADD COLUMN avans_ref uuid REFERENCES firma_malzeme_avansi (kimlik), ADD COLUMN mahsup_eur numeric(14,2) NOT NULL DEFAULT 0, ADD COLUMN tutulan_eur numeric(14,2) NOT NULL DEFAULT 0, ADD COLUMN odeme_listesi_ref uuid REFERENCES odeme_listesi (kimlik), ADD COLUMN acil_gerekce text, ADD COLUMN acil_onayli boolean NOT NULL DEFAULT false;
CREATE TABLE talimat_mahsubu (
  talimat_ref uuid NOT NULL REFERENCES odeme_talimati (kimlik), mahsup_ref uuid NOT NULL REFERENCES hakedis_mahsubu (kimlik), tutar_eur numeric(14,2) NOT NULL, PRIMARY KEY (talimat_ref, mahsup_ref)
);
ALTER TABLE tedarikci_faturasi ADD COLUMN odeme_listesi_ref uuid REFERENCES odeme_listesi (kimlik);
ALTER TABLE hakedis ADD COLUMN firma_fatura_tarihi date, ADD COLUMN firma_fatura_kuru numeric(10,4);
ALTER TABLE acik_is_kalemi ADD COLUMN bedel_eur numeric(14,2) NOT NULL DEFAULT 0 CHECK (bedel_eur >= 0);
ALTER TABLE is_karti ADD COLUMN ayrik_kullanicilar text[] NOT NULL DEFAULT '{}';
GRANT SELECT, INSERT, UPDATE ON odeme_listesi, firma_malzeme_avansi, hakedis_mahsubu, talimat_mahsubu TO yatonet_uygulama;
