-- YG-254, YG-274: onay beklenmeden yapılan acil müdahalenin kapanış kaydı.
ALTER TABLE acil_mudahale ADD COLUMN mudahale_kapsami text, ADD COLUMN gerekce text, ADD COLUMN yetkili_kisi text, ADD COLUMN kaynak text,
  ADD COLUMN sonradan_tamamlanacak text, ADD COLUMN devam_karari text CHECK (devam_karari IN ('Esas Onarıma Devam', 'Dosya Kapatılsın')), ADD COLUMN normal_akis_zamani timestamptz;
