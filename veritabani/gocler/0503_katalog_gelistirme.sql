-- YG-662 (V-1137): katalogda bulunmayan iş için kapsam cetvelinde açılan geçici kalem katalog geliştirme kuyruğuna düşer.
-- Aynı dosyada aynı açıklamalı kalem (cetvel sürümleri arasında) tek kayıttır. Kalem kart önerisine bağlanır; öneri onaylanınca kataloğa eklenir,
-- Ticari İşler Direktörü gerekçeyle kataloğa almamaya karar verebilir.
CREATE TABLE katalog_gelistirme_kaydi (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), dosya_ref uuid NOT NULL REFERENCES dosya (kimlik), kapsam_satiri_ref uuid NOT NULL REFERENCES kapsam_satiri (kimlik),
  anahtar text NOT NULL, aciklama text NOT NULL, birim text NOT NULL,
  durum text NOT NULL DEFAULT 'Kuyrukta' CHECK (durum IN ('Kuyrukta', 'Öneri Hazırlandı', 'Kataloğa Eklendi', 'Kataloğa Alınmadı')),
  kart_onerisi_ref uuid REFERENCES kart_onerisi (kimlik), kartela_kodu text,
  karar_gerekcesi text, karar_veren_ref text REFERENCES kullanici_hesabi (kimlik), karar_zamani timestamptz,
  olusturma_zamani timestamptz NOT NULL DEFAULT now(), UNIQUE (dosya_ref, anahtar)
);
CREATE INDEX katalog_gelistirme_durum ON katalog_gelistirme_kaydi (durum);
GRANT SELECT, INSERT, UPDATE ON katalog_gelistirme_kaydi TO yatonet_uygulama;
-- Kuyruğa düşmesi gereken mevcut geçici kalemler.
INSERT INTO katalog_gelistirme_kaydi (dosya_ref, kapsam_satiri_ref, anahtar, aciklama, birim, olusturma_zamani)
SELECT DISTINCT ON (c.dosya_ref, lower(btrim(s.aciklama))) c.dosya_ref, s.kimlik, lower(btrim(s.aciklama)), btrim(s.aciklama), s.birim, c.olusturma_zamani
FROM kapsam_satiri s JOIN kapsam_cetveli c ON c.kimlik = s.cetvel_ref WHERE s.kartela_disi
ORDER BY c.dosya_ref, lower(btrim(s.aciklama)), c.surum
ON CONFLICT DO NOTHING;
INSERT INTO durum_sozlugu (kayit_turu, durum, is_anlami, giris_kosulu, cikis_kosulu, yetkili_rol, izinli_gecisler, zorunlu_aciklama, sure_durur, otomatik_bildirim, musteri_adi) VALUES
  ('katalog_gelistirme_kaydi', 'Kuyrukta', 'Katalogda bulunmayan iş için açılan geçici kalem katalog geliştirme kuyruğunda, kart önerisi bekliyor.', 'Kapsam cetvelinde kartela kodu olmayan satır kaydedilince', 'Kart önerisi hazırlanınca Öneri Hazırlandı; Ticari İşler Direktörü kararıyla Kataloğa Alınmadı', 'Teknik Uzman', ARRAY['Öneri Hazırlandı', 'Kataloğa Alınmadı']::text[], false, false, NULL, NULL),
  ('katalog_gelistirme_kaydi', 'Öneri Hazırlandı', 'Geçici kalem için kart önerisi hazırlandı, Ticari İşler Direktörü onayında.', 'Teknik Uzman kalemi kart önerisine bağlayınca', 'Öneri onaylanınca Kataloğa Eklendi; reddedilince Kuyrukta', 'Ticari İşler Direktörü', ARRAY['Kataloğa Eklendi', 'Kuyrukta']::text[], false, false, NULL, NULL),
  ('katalog_gelistirme_kaydi', 'Kataloğa Eklendi', 'Geçici kalem kart önerisiyle yeni kodla kataloğa eklendi.', 'Bağlı kart önerisi onaylanınca', 'Son durum; değişmez', 'Ticari İşler Direktörü', '{}'::text[], false, false, NULL, NULL),
  ('katalog_gelistirme_kaydi', 'Kataloğa Alınmadı', 'Geçici kalem dosyaya özgü kaldı; kataloğa eklenmedi, gerekçe kayıtlıdır.', 'Ticari İşler Direktörü gerekçeyle karar verince', 'Son durum; değişmez', 'Ticari İşler Direktörü', '{}'::text[], true, false, NULL, NULL);
