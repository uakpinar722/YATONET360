-- YG-1685 (¶2617): garanti düzeltmesinin Kalite Kontrolörce yeniden doğrulanması; sonuç garanti kaydına bağlanır.
ALTER TABLE garanti_sikayet ADD COLUMN yeniden_dogrulama_sonucu text CHECK (yeniden_dogrulama_sonucu IN ('Doğrulandı', 'Doğrulanmadı')), ADD COLUMN yeniden_dogrulama_notu text,
  ADD COLUMN yeniden_dogrulayan_ref text REFERENCES kullanici_hesabi (kimlik), ADD COLUMN yeniden_dogrulama_zamani timestamptz;
