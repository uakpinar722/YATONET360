-- YG-1460: POS ve ödeme bağlantısı banka/ödeme kuruluşu seçimi ve entegrasyondan sonra açılır (1); o zamana kadar yalnız havale (IBAN).
INSERT INTO sistem_parametresi (kod, deger, aciklama) VALUES ('pos_odeme_baglantisi_acik', 0, 'POS ve ödeme bağlantısı açık mı (1 açık, 0 kapalı; banka seçimine kadar kapalı)') ON CONFLICT (kod) DO NOTHING;
