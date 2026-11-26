-- YG-331 (CEO 26.11.2026): yatın bulunduğu tesis (bağlama noktası/marina/tersane) dosyada yapısal olarak tutulur; dış firma kuralı ve işletme izni uyarıları buna bağlanır.
ALTER TABLE dosya ADD COLUMN bulundugu_tesis_ref uuid REFERENCES firma_tesisi (kimlik);
