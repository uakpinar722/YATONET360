-- YG-1712, YG-1713: kimlik doğrulama süreleri sistem parametresi.
INSERT INTO sistem_parametresi (kod, deger, aciklama) VALUES
  ('kimlik_sms_kod_gecerlilik_dk', 5, 'SMS doğrulama kodunun geçerlilik süresi (dakika)'),
  ('kimlik_sms_yeniden_gonderim_sn', 60, 'Yeni SMS kodu istenebilecek en kısa süre (saniye)'),
  ('kimlik_kod_asamasi_dk', 10, 'Parola adımı ile kod adımı arasındaki en uzun süre (dakika)'),
  ('kimlik_parola_sifirlama_dk', 60, 'Parola yenileme bağlantısının geçerlilik süresi (dakika)'),
  ('kimlik_adres_deneme_siniri', 30, 'Aynı adresten başarısız giriş/kod denemesi sınırı'),
  ('kimlik_adres_deneme_penceresi_dk', 10, 'Adres deneme sınırının pencere süresi (dakika)')
ON CONFLICT DO NOTHING;
