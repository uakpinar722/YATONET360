-- YG-110: kışa sarkan dosyada kışlık hazırlık sorumlusu (LGM personeli ya da dosya tarafı).
ALTER TABLE dosya ADD COLUMN IF NOT EXISTS kislik_sorumlu_kullanici_ref text REFERENCES kullanici_hesabi (kimlik);
ALTER TABLE dosya ADD COLUMN IF NOT EXISTS kislik_sorumlu_taraf_ref uuid REFERENCES dosya_tarafi (kimlik);
INSERT INTO sistem_parametresi (kod, deger, aciklama) VALUES
  ('kis_baslangic_ay', 11, 'Kış döneminin başladığı ay (1–12)'),
  ('kis_bitis_ay', 3, 'Kış döneminin bittiği ay (1–12)')
ON CONFLICT (kod) DO NOTHING;
