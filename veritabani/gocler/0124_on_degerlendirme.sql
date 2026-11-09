-- YG-651: RP-OPS-001 Ön Değerlendirme Raporu; sürümlü, önceki sürüm değişmez.
CREATE TABLE on_degerlendirme (kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), dosya_ref uuid NOT NULL REFERENCES dosya (kimlik), surum integer NOT NULL, veriler jsonb NOT NULL, risk jsonb NOT NULL, hazirlayan_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), olusturma_zamani timestamptz NOT NULL DEFAULT now(), UNIQUE (dosya_ref, surum));
GRANT SELECT, INSERT ON on_degerlendirme TO yatonet_uygulama;
ALTER TABLE belge_uretim DROP CONSTRAINT belge_uretim_tur_check;
ALTER TABLE belge_uretim ADD CONSTRAINT belge_uretim_tur_check CHECK (tur IN ('Fiyat Teklifi', 'Teknik Rapor', 'Onay Belgesi', 'Proforma', 'Ödeme Talebi', 'İş Emri', 'Teslim Tutanağı', 'Ödeme Sorumluluğu', 'Uyuşmazlık Paketi', 'Mutabakat Raporu', 'Kurtarma Sözleşmesi', 'Ön Bilgilendirme Formu', 'Yöntem Bilgi Nüshası', 'Nihai Kapanış Özeti', 'Ön Değerlendirme Raporu'));
