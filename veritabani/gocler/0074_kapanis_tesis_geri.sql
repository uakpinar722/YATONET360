-- YG-416: dosya kapanınca yanıt bekleyen tesis talepleri geri çekilir.
ALTER TABLE tesis_talebi DROP CONSTRAINT IF EXISTS tesis_talebi_durum_check;
ALTER TABLE tesis_talebi ADD CONSTRAINT tesis_talebi_durum_check CHECK (durum IN ('Yanıt Bekliyor', 'Onaylı', 'İzin Verilmedi', 'Geri Çekildi'));
