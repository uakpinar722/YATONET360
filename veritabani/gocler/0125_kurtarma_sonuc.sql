-- YG-644 FR-OPS-013 sonuç tutanağı; YG-275 resmî talimat kaydı.
CREATE TABLE kurtarma_sonuc (operasyon_ref uuid PRIMARY KEY REFERENCES kurtarma_operasyonu (kimlik), veriler jsonb NOT NULL, durum text NOT NULL DEFAULT 'Kontrolde' CHECK (durum IN ('Kontrolde', 'Onaylandı', 'İade')), iade_gerekcesi text, giren_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), zaman timestamptz NOT NULL DEFAULT now(), kontrol_eden_ref text REFERENCES kullanici_hesabi (kimlik), kontrol_zamani timestamptz);
CREATE TABLE kurtarma_talimat (kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), operasyon_ref uuid NOT NULL REFERENCES kurtarma_operasyonu (kimlik), metin text NOT NULL, giren_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), zaman timestamptz NOT NULL DEFAULT now());
GRANT SELECT, INSERT, UPDATE ON kurtarma_sonuc TO yatonet_uygulama;
GRANT SELECT, INSERT ON kurtarma_talimat TO yatonet_uygulama;
ALTER TABLE belge_uretim DROP CONSTRAINT belge_uretim_tur_check;
ALTER TABLE belge_uretim ADD CONSTRAINT belge_uretim_tur_check CHECK (tur IN ('Fiyat Teklifi', 'Teknik Rapor', 'Onay Belgesi', 'Proforma', 'Ödeme Talebi', 'İş Emri', 'Teslim Tutanağı', 'Ödeme Sorumluluğu', 'Uyuşmazlık Paketi', 'Mutabakat Raporu', 'Kurtarma Sözleşmesi', 'Ön Bilgilendirme Formu', 'Yöntem Bilgi Nüshası', 'Nihai Kapanış Özeti', 'Ön Değerlendirme Raporu', 'Kurtarma Sonuç Tutanağı'));
