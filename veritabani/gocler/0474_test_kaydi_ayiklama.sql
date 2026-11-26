-- YG-1259, TZ-4 (CEO 26.11.2026): aktarılan firma/tesis kayıtlarında test kaydı şüphesi; Sicil Sorumlusu "Ayıklandı" veya "Gerçek Kayıt" der, kayıt silinmez.
ALTER TABLE kurulus ADD COLUMN test_suphesi boolean NOT NULL DEFAULT false, ADD COLUMN test_ayiklama text CHECK (test_ayiklama IN ('Ayıklandı', 'Gerçek Kayıt')),
  ADD COLUMN test_ayiklayan_ref text REFERENCES kullanici_hesabi (kimlik), ADD COLUMN test_ayiklama_zamani timestamptz;
ALTER TABLE baglama_noktasi ADD COLUMN test_suphesi boolean NOT NULL DEFAULT false, ADD COLUMN test_ayiklama text CHECK (test_ayiklama IN ('Ayıklandı', 'Gerçek Kayıt')),
  ADD COLUMN test_ayiklayan_ref text REFERENCES kullanici_hesabi (kimlik), ADD COLUMN test_ayiklama_zamani timestamptz;
GRANT UPDATE (test_suphesi, test_ayiklama, test_ayiklayan_ref, test_ayiklama_zamani) ON kurulus, baglama_noktasi TO yatonet_uygulama;
