-- YG-1592: atanan Tedarik Sorumlusu çıkar çatışması bildirirse talep yeniden atanır; beyan kaydı tutulur.
ALTER TABLE tedarik_dagitim ADD COLUMN cikar_beyani text, ADD COLUMN beyan_zamani timestamptz, ADD COLUMN onceki_sorumlu_ref text REFERENCES kullanici_hesabi (kimlik);
GRANT UPDATE (sorumlu_ref, atayan_ref, zaman, cikar_beyani, beyan_zamani, onceki_sorumlu_ref) ON tedarik_dagitim TO yatonet_uygulama;
