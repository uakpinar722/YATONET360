-- YG-1081, YG-859: kartela maliyeti yalnız Ticari İşler Direktörü ve CEO tarafından taslak sürümde girilir; maliyet tarihi ve kaynak norm zorunlu ve görünürdür. Taslak CEO onayıyla yürürlüğe girer, önceki sürüm arşive düşer.
ALTER TABLE kartela_kalemi ADD COLUMN IF NOT EXISTS maliyet_tarihi date, ADD COLUMN IF NOT EXISTS kaynak_norm text;
ALTER TABLE kartela_surumu ADD COLUMN IF NOT EXISTS hazirlayan_ref text REFERENCES kullanici_hesabi (kimlik);
GRANT INSERT, UPDATE ON kartela_surumu TO yatonet_uygulama; GRANT UPDATE ON kartela_kalemi TO yatonet_uygulama;
