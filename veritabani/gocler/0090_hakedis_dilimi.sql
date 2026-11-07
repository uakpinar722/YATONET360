-- YG-837: hakediş aylık ya da bu tutarlık dilimlerle verilir.
INSERT INTO sistem_parametresi (kod, deger, aciklama) VALUES ('hakedis_dilim_eur', 20000, 'Aylık dönem dolmadan verilebilecek asgari hakediş tutarı (EUR)') ON CONFLICT (kod) DO NOTHING;
