-- YG-1017: unvan–rol eşleşmesi. Unvan, rol adındaki parantez içidir (Kalite Uzmanı (Kalite Kontrolör) → Kalite Kontrolör), yoksa rol adıdır.
-- Kademe ve birim rol kaydından gelir; Teknik Yönetici ve Operasyon Yöneticisi ilgili müdürlüğün Yönetici kademesidir.
CREATE VIEW unvan_rol_eslesmesi AS
  SELECT kimlik rol_ref, rol_adi, coalesce(substring(rol_adi FROM '\(([^)]+)\)$'), rol_adi) unvan, kademe, rol_sahibi_birim birim
  FROM rol WHERE rol_durumu = 'Aktif';
GRANT SELECT ON unvan_rol_eslesmesi TO yatonet_uygulama;
