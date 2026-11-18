-- Komşu Bölge Tablosu (CEO 18.11.2026; K-224 'komşuluk tablosu yok' kararının yerine). Komşuluk ana veri bölge–il dağılımından: iki bölge aynı ili paylaşıyor veya kıyıda bitişik illerde.
-- 8. İç sular ve ulusal havuz bölgesinin komşusu yoktur (iç sular; ulusal havuz). Değişiklik Firma Yönetimi Müdürü önerisi, BT ve Firma Yönetimi Direktörü onayıyla.
CREATE TABLE komsu_bolge (bolge text NOT NULL, komsu text NOT NULL, dayanak text NOT NULL, PRIMARY KEY (bolge, komsu), CHECK (bolge <> komsu));
INSERT INTO komsu_bolge (bolge, komsu, dayanak) VALUES
  ('1. Marmara', '2. Kuzey Ege', 'Balıkesir ve Çanakkale iki bölgede'),
  ('2. Kuzey Ege', '1. Marmara', 'Balıkesir ve Çanakkale iki bölgede'),
  ('1. Marmara', '7. Karadeniz', 'Kocaeli iki bölgede; İstanbul–Kırklareli kara sınırı'),
  ('7. Karadeniz', '1. Marmara', 'Kocaeli iki bölgede; İstanbul–Kırklareli kara sınırı'),
  ('2. Kuzey Ege', '3. Güney Ege', 'İzmir–Aydın komşu iller'),
  ('3. Güney Ege', '2. Kuzey Ege', 'İzmir–Aydın komşu iller'),
  ('3. Güney Ege', '4. Batı Akdeniz', 'Muğla iki bölgede'),
  ('4. Batı Akdeniz', '3. Güney Ege', 'Muğla iki bölgede'),
  ('4. Batı Akdeniz', '5. Antalya', 'Antalya iki bölgede'),
  ('5. Antalya', '4. Batı Akdeniz', 'Antalya iki bölgede'),
  ('5. Antalya', '6. Doğu Akdeniz', 'Mersin iki bölgede'),
  ('6. Doğu Akdeniz', '5. Antalya', 'Mersin iki bölgede');
GRANT SELECT ON komsu_bolge TO yatonet_uygulama;
