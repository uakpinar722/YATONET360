-- YG-010: olay kaydı LGM-OL önekli numara taşır (LGM-OL-00001); mevcut kayıtlar oluşturma sırasıyla numaralanır, sayaç kaldığı yerden sürer.
ALTER TABLE olay_kaydi ADD COLUMN IF NOT EXISTS olay_no text UNIQUE;
UPDATE olay_kaydi o SET olay_no = 'LGM-OL-' || lpad(s.n::text, 5, '0') FROM (SELECT kimlik, row_number() OVER (ORDER BY olusturma_zamani, kimlik) n FROM olay_kaydi WHERE olay_no IS NULL) s WHERE o.kimlik = s.kimlik;
INSERT INTO numara_sayaci (anahtar, son) SELECT 'olay-kaydi', count(*) FROM olay_kaydi ON CONFLICT (anahtar) DO UPDATE SET son = GREATEST(numara_sayaci.son, EXCLUDED.son);
