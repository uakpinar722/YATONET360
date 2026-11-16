-- YG-1246: veri düzeltme talebi yat dışında taraf ve firma (kuruluş) kayıtlarında da açılır.
ALTER TABLE veri_duzeltme_talebi DROP CONSTRAINT IF EXISTS veri_duzeltme_talebi_nesne_turu_check;
ALTER TABLE veri_duzeltme_talebi ADD CONSTRAINT veri_duzeltme_talebi_nesne_turu_check CHECK (nesne_turu IN ('Yat', 'Taraf', 'Kuruluş'));
