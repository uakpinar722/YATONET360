-- YG-1440: belgenin geçerlilik bitişi; süresi dolan yat belgesi yeniden istenir.
ALTER TABLE belge ADD COLUMN gecerlilik_bitis date, ADD COLUMN yenileme_istendi timestamptz;
