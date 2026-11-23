-- YG-550: teslim alınmayan yatta 30. gün risk geçişi zamanı.
ALTER TABLE dosya ADD COLUMN teslim_risk_gecis_zamani timestamptz;
-- YG-1486: yurt dışı dosyada randevu sayacının başladığı ulaşım planı zamanı.
ALTER TABLE dosya ADD COLUMN ulasim_plani_zamani timestamptz;
-- YG-246: devirde dosyaya aktarılmamış e-posta/telefon ihbarları.
ALTER TABLE nobet_devri ADD COLUMN devir_ihbarlari jsonb NOT NULL DEFAULT '[]';
