-- YG-145: kurtarma sonrası açılan onarım talebi önceki dosyaya bağlanır.
ALTER TABLE talep ADD COLUMN IF NOT EXISTS onceki_dosya_ref uuid REFERENCES dosya (kimlik);
