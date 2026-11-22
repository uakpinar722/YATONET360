-- YG-1369: çevrim dışı çakışmanın süreç sahibince çözümü.
ALTER TABLE mobil_esitleme ADD COLUMN dosya_ref uuid REFERENCES dosya (kimlik), ADD COLUMN sorumlu_ref text REFERENCES kullanici_hesabi (kimlik),
  ADD COLUMN cozum text CHECK (cozum IN ('Platform Kaydı Esas', 'Cihaz Kaydı Uygulandı')), ADD COLUMN cozum_gerekcesi text, ADD COLUMN cozen_ref text REFERENCES kullanici_hesabi (kimlik), ADD COLUMN cozum_zamani timestamptz,
  ADD CONSTRAINT mobil_esitleme_cozum CHECK (cozum IS NULL OR (durum = 'Çakışma' AND cozum_gerekcesi IS NOT NULL AND cozen_ref IS NOT NULL AND cozum_zamani IS NOT NULL));
CREATE INDEX mobil_esitleme_acik_cakisma ON mobil_esitleme (sorumlu_ref) WHERE durum = 'Çakışma' AND cozum IS NULL;
GRANT UPDATE ON mobil_esitleme TO yatonet_uygulama;
