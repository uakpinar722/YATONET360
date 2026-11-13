-- YG-730: değiştirilen parçanın teslimi veya imhası fotoğraflı kayıt; imha sigortalı dosyada sigorta onayıyla.
ALTER TABLE sokulen_parca ADD COLUMN sonuc text CHECK (sonuc IN ('Teslim Edildi', 'İmha Edildi')), ADD COLUMN sonuc_foto_ref uuid REFERENCES belge (kimlik), ADD COLUMN sigorta_onay_ref uuid REFERENCES belge (kimlik),
  ADD COLUMN sonuc_kaydeden_ref text REFERENCES kullanici_hesabi (kimlik), ADD COLUMN sonuc_zamani timestamptz;
