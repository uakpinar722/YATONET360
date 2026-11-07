-- YG-1457: yat sahibine ve sigortaya bildirilen onarım süresi, firmanın tahmini süresinin tampon kadar fazlasıdır (tampon LGM'de).
INSERT INTO sistem_parametresi (kod, deger, aciklama) VALUES ('onarim_sure_tamponu', 0.2, 'Bildirilen onarım süresi tamponu (oran; 0,2 = %20)') ON CONFLICT (kod) DO NOTHING;
ALTER TABLE fiyat_teklifi ADD COLUMN IF NOT EXISTS bildirilen_sure_gun integer CHECK (bildirilen_sure_gun > 0);
