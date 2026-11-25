-- YG-1015: ortak sicil yapısında (kurulus) tedarikçi sicilinin sahibi Teknik ve Operasyon (Tedarik Yönetimi Müdürlüğü), Çözüm Ortağı sicilinin sahibi BT ve Firma Yönetimi (Firma Yönetimi Müdürlüğü).
INSERT INTO veri_kumesi (kod, ad, sahip_rol, yetkili_kaynak, kalite_boyutlari, esik_yuzde, olcum_donemi, duzeltme_sorumlusu) VALUES
  ('TEDARIKCI', 'Tedarikçi Sicili', 'Tedarik Yönetimi Müdürü', 'Tedarikçi sicili ve sicil belgeleri (ortak sicil yapısında tedarikçi kayıtları)', '{Doğruluk,Güncellik,Tekillik}', 98, 'Aylık', 'Tedarik Sorumlusu')
ON CONFLICT (kod) DO NOTHING;
UPDATE veri_kumesi SET ad = 'Çözüm Ortağı ve Tesis Sicili' WHERE kod = 'FIRMA' AND ad = 'Firma Sicili';
