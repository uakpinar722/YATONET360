-- YG-158: talimat/karar kaynağı dosya tarafına bağlanır; yetkisiz kaynaktan geleni Dosya Sorumlusu doğrular veya dikkate almaz. Özgün metin değişmez.
ALTER TABLE talimat_kaydi ADD COLUMN IF NOT EXISTS kaynak_taraf_ref uuid REFERENCES dosya_tarafi (kimlik), ADD COLUMN IF NOT EXISTS kaynak_yetkili boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS kaynak_sonucu text CHECK (kaynak_sonucu IN ('Doğrulandı', 'Dikkate Alınmadı')), ADD COLUMN IF NOT EXISTS kaynak_notu text, ADD COLUMN IF NOT EXISTS kaynak_dogrulayan_ref text REFERENCES kullanici_hesabi (kimlik), ADD COLUMN IF NOT EXISTS kaynak_dogrulama_zamani timestamptz;
-- Eski kayıtlar kapıyı kilitlemez.
UPDATE talimat_kaydi SET kaynak_yetkili = true WHERE kaynak_taraf_ref IS NULL AND kaynak_sonucu IS NULL AND kayit_zamani < now();
GRANT UPDATE (kaynak_sonucu, kaynak_notu, kaynak_dogrulayan_ref, kaynak_dogrulama_zamani) ON talimat_kaydi TO yatonet_uygulama;
