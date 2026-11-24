-- YG-1483: Kritik dosyada acil tedbir değerlendirmesi (yerinde veya firma ön keşfi + görüntülü).
CREATE TABLE acil_degerlendirme (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), dosya_ref uuid NOT NULL REFERENCES dosya (kimlik),
  yontem text NOT NULL CHECK (yontem IN ('Yerinde', 'Uzaktan (Firma Ön Keşfi ve Görüntülü)')),
  firma_ref uuid REFERENCES kurulus (kimlik), firma_on_kesif_ozeti text, gorusme_zamani timestamptz,
  sonuc text NOT NULL, acil_tedbir text NOT NULL, degerlendiren_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), zaman timestamptz NOT NULL DEFAULT now(),
  CHECK (yontem = 'Yerinde' OR (firma_ref IS NOT NULL AND firma_on_kesif_ozeti IS NOT NULL AND gorusme_zamani IS NOT NULL))
);
CREATE INDEX acil_degerlendirme_dosya ON acil_degerlendirme (dosya_ref);
GRANT SELECT, INSERT ON acil_degerlendirme TO yatonet_uygulama;
