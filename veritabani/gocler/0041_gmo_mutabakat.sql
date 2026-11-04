-- YG-1707: GMO Y12-02 Madde 3 ve Madde 6, 10; kartela tutarı referans yat için, tutar yat boyutuna oranlanır. YG-456: mutabakat raporu PDF.
ALTER TABLE yat ADD COLUMN genislik_m numeric(6,2) CHECK (genislik_m > 0), ADD COLUMN derinlik_m numeric(6,2) CHECK (derinlik_m > 0);
INSERT INTO sistem_parametresi (kod, deger, aciklama) VALUES
  ('gmo_sabit', 10000, 'GMO Y12-02 Madde 3 formül sabiti (50 m altı yat)'),
  ('gmo_ref_boy', 20, 'GMO kartela referans yat tam boy (m)'),
  ('gmo_ref_genislik', 5.5, 'GMO kartela referans yat kalıp genişliği (m)'),
  ('gmo_ref_derinlik', 2.8, 'GMO kartela referans yat kalıp derinliği (m)'),
  ('gmo_azami_boy', 50, 'GMO yat formülünün geçerli olduğu boy sınırı (m)');
ALTER TABLE belge_uretim DROP CONSTRAINT belge_uretim_tur_check;
ALTER TABLE belge_uretim ADD CONSTRAINT belge_uretim_tur_check CHECK (tur IN ('Fiyat Teklifi', 'Teknik Rapor', 'Onay Belgesi', 'Proforma', 'Ödeme Talebi', 'İş Emri', 'Teslim Tutanağı', 'Ödeme Sorumluluğu', 'Uyuşmazlık Paketi', 'Mutabakat Raporu'));
