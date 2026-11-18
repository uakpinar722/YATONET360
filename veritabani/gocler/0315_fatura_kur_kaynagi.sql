-- YG-875: fatura kurunun kaynağı (TCMB veya yayın kesintisinde Elle) kayda geçer.
ALTER TABLE musteri_faturasi ADD COLUMN kur_kaynagi text CHECK (kur_kaynagi IN ('TCMB', 'Elle'));
