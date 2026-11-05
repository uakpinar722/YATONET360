-- Veritabanı Türkçe kuralıyla I harfini ı yapar; e-posta karşılaştırması dilden bağımsız olmalıdır.
DROP INDEX kullanici_hesabi_e_posta_tekil;
CREATE UNIQUE INDEX kullanici_hesabi_e_posta_tekil ON kullanici_hesabi (lower(e_posta COLLATE "C")) WHERE e_posta IS NOT NULL;
