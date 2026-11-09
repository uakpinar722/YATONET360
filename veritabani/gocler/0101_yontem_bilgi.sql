-- YNT-2: yat sahibine Onarım Yöntem Raporu bilgi nüshası.
ALTER TABLE belge_uretim DROP CONSTRAINT belge_uretim_tur_check;
ALTER TABLE belge_uretim ADD CONSTRAINT belge_uretim_tur_check CHECK (tur IN ('Fiyat Teklifi', 'Teknik Rapor', 'Onay Belgesi', 'Proforma', 'Ödeme Talebi', 'İş Emri', 'Teslim Tutanağı', 'Ödeme Sorumluluğu', 'Uyuşmazlık Paketi', 'Mutabakat Raporu', 'Kurtarma Sözleşmesi', 'Ön Bilgilendirme Formu', 'Yöntem Bilgi Nüshası'));
