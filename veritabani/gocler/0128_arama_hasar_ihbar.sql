-- YG-1373: arama Türkçe karakter ve büyük-küçük harf farkını gözetmez. YG-715: FR-OPS-009 iç kaydı.
CREATE OR REPLACE FUNCTION tr_norm(t text) RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT lower(translate(t, 'İIıŞşĞğÜüÖöÇçÂâÎîÛû', 'iiissgguuoocCaaiiuu')) $$;
ALTER TABLE belge_uretim DROP CONSTRAINT belge_uretim_tur_check;
ALTER TABLE belge_uretim ADD CONSTRAINT belge_uretim_tur_check CHECK (tur IN ('Fiyat Teklifi', 'Teknik Rapor', 'Onay Belgesi', 'Proforma', 'Ödeme Talebi', 'İş Emri', 'Teslim Tutanağı', 'Ödeme Sorumluluğu', 'Uyuşmazlık Paketi', 'Mutabakat Raporu', 'Kurtarma Sözleşmesi', 'Ön Bilgilendirme Formu', 'Yöntem Bilgi Nüshası', 'Nihai Kapanış Özeti', 'Ön Değerlendirme Raporu', 'Kurtarma Sonuç Tutanağı', 'Hasar İhbar ve İlk Kayıt'));
