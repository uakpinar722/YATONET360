-- CEO 25.11.2026 (V-1084 düzeltmesi): tüm dış kaynak firmaların (Çözüm Ortağı, tedarikçi, tesis) kaydı ve sicili Firma Yönetimi Müdüründedir; tedarik işlemleri Tedarik Yönetimi Müdüründedir.
DELETE FROM veri_kumesi WHERE kod = 'TEDARIKCI';
UPDATE veri_kumesi SET ad = 'Firma Sicili' WHERE kod = 'FIRMA';
INSERT INTO veri_kumesi (kod, ad, sahip_rol, yetkili_kaynak, kalite_boyutlari, esik_yuzde, olcum_donemi, duzeltme_sorumlusu) VALUES
  ('TEDARIK', 'Tedarik İşlemleri', 'Tedarik Yönetimi Müdürü', 'Tedarik siparişleri, malzeme giriş kabulleri ve tedarikçi faturaları', '{Doğruluk,Güncellik,Tamlık}', 98, 'Aylık', 'Tedarik Sorumlusu')
ON CONFLICT (kod) DO NOTHING;
