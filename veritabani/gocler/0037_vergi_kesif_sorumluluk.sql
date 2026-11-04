-- YG-878, YG-879, YG-881 vergi; YG-874 KDV TL; YG-864, YG-865, YG-1487 keşif ücreti; YG-894, YG-896 ödeme sorumluluğu.
ALTER TABLE taraf ADD COLUMN kdv_istisna_belge_ref uuid REFERENCES belge (kimlik), ADD COLUMN kdv_istisna_bitis date;
CREATE TABLE sigorta_vergi_profili (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), sigortaci_adi text NOT NULL, kdv_uygulamasi text NOT NULL CHECK (kdv_uygulamasi IN ('Standart KDV', 'KDV tevkifatlı')), tevkifat_pay integer CHECK (tevkifat_pay > 0), tevkifat_payda integer CHECK (tevkifat_payda > 0), yururluk date NOT NULL, dayanak_belge_ref uuid NOT NULL REFERENCES belge (kimlik), kaydeden_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), zaman timestamptz NOT NULL DEFAULT now(), UNIQUE (sigortaci_adi, yururluk),
  CHECK ((kdv_uygulamasi = 'KDV tevkifatlı') = (tevkifat_pay IS NOT NULL AND tevkifat_payda IS NOT NULL))
);
ALTER TABLE musteri_faturasi ALTER COLUMN teklif_ref DROP NOT NULL, ADD COLUMN kdv_durumu text NOT NULL DEFAULT 'Standart KDV' CHECK (kdv_durumu IN ('Standart KDV', 'KDV tevkifatlı', 'KDV istisnası')), ADD COLUMN kdv_orani numeric(5,2), ADD COLUMN kdv_matrahi_eur numeric(14,2), ADD COLUMN tevkifat_orani text, ADD COLUMN tevkifat_eur numeric(14,2) NOT NULL DEFAULT 0, ADD COLUMN kdv_tl numeric(14,2), ADD COLUMN aciklama text;
CREATE TABLE odeme_sorumlulugu_kalemi (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), dosya_ref uuid NOT NULL REFERENCES dosya (kimlik), tur text NOT NULL CHECK (tur IN ('Acil Tedbir', 'Keşif Söküm-Montaj', 'Bekleme ve Muhafaza')), aciklama text NOT NULL, tutar_eur numeric(14,2) NOT NULL CHECK (tutar_eur > 0), durum text NOT NULL DEFAULT 'Sigorta Kararı Bekleniyor' CHECK (durum IN ('Sigorta Kararı Bekleniyor', 'Sigorta Öder', 'Yat Sahibine Aktarıldı')), odeme_talebi_ref uuid REFERENCES odeme_talebi (kimlik), giren_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), olusturma_zamani timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX odeme_sorumlulugu_dosya ON odeme_sorumlulugu_kalemi (dosya_ref);
ALTER TABLE belge_uretim DROP CONSTRAINT belge_uretim_tur_check;
ALTER TABLE belge_uretim ADD CONSTRAINT belge_uretim_tur_check CHECK (tur IN ('Fiyat Teklifi', 'Teknik Rapor', 'Onay Belgesi', 'Proforma', 'Ödeme Talebi', 'İş Emri', 'Teslim Tutanağı', 'Ödeme Sorumluluğu'));
GRANT SELECT, INSERT, UPDATE ON sigorta_vergi_profili, odeme_sorumlulugu_kalemi TO yatonet_uygulama;
