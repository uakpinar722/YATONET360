-- YG-082: paket bazında garanti başlangıcı ve kaynağı.
ALTER TABLE kabul_kaydi ADD COLUMN garanti_kaynagi text CHECK (garanti_kaynagi IN ('İşçilik', 'Firma Tedariki', 'Üretici', 'Müşteri Tedariki'));
