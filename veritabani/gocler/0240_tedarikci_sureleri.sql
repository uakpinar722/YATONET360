-- YG-869: tedarikçi çerçeve sözleşmesinde boş süre alanları için varsayılan süreler ve sipariş verilme zamanı.
INSERT INTO sistem_parametresi (kod, deger, aciklama) VALUES
  ('tedarik_siparis_kabul_saat', 48, 'Tedarikçi sipariş kabulü süresi (saat), sözleşmede boşsa'),
  ('tedarik_uygunsuzluk_ilk_yanit_saat', 48, 'Tedarikçinin uygunsuzluğa ilk yanıt süresi (saat), sözleşmede boşsa'),
  ('tedarik_duzeltici_plan_gun', 10, 'Tedarikçinin düzeltici faaliyet planı süresi (gün), sözleşmede boşsa')
ON CONFLICT DO NOTHING;
ALTER TABLE tedarik_siparisi ADD COLUMN verilme_zamani timestamptz;
