-- YG-1662 (V-1146): Bölgesel kapasitede firması olmayan veya tek firmaya bağlı branş-bölge için Bilgi Teknolojileri ve Firma Yönetimi Direktörü
-- ağ geliştirme önerisi yazar; öneri Genel Müdür Yardımcısının onayına gider.
CREATE TABLE ag_gelistirme_onerisi (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), ana_brans text NOT NULL, bolge text NOT NULL, mevcut_firma integer NOT NULL,
  oneri text NOT NULL, durum text NOT NULL DEFAULT 'Onayda' CHECK (durum IN ('Onayda', 'Onaylandı', 'Reddedildi', 'İade Edildi')),
  hazirlayan_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), olusturma_zamani timestamptz NOT NULL DEFAULT now(),
  karar_veren_ref text REFERENCES kullanici_hesabi (kimlik), karar_zamani timestamptz
);
CREATE UNIQUE INDEX ag_gelistirme_acik ON ag_gelistirme_onerisi (ana_brans, bolge) WHERE durum = 'Onayda';
GRANT SELECT, INSERT, UPDATE ON ag_gelistirme_onerisi TO yatonet_uygulama;
INSERT INTO durum_sozlugu (kayit_turu, durum, is_anlami, giris_kosulu, cikis_kosulu, yetkili_rol, izinli_gecisler, zorunlu_aciklama, sure_durur, otomatik_bildirim, musteri_adi) VALUES
  ('ag_gelistirme_onerisi', 'Onayda', 'Kayıt onay zincirinde, sıradaki makamın kararını bekliyor; içerik değiştirilemez.', 'Direktör öneriyi gönderince', 'Genel Müdür Yardımcısının kararıyla Onaylandı, Reddedildi veya İade Edildi', 'Genel Müdür Yardımcısı', ARRAY['Onaylandı', 'Reddedildi', 'İade Edildi'], false, false, NULL, NULL),
  ('ag_gelistirme_onerisi', 'Onaylandı', 'Kayıt son yetkili makam tarafından kabul edildi ve sonuç doğurur.', 'Genel Müdür Yardımcısı onaylayınca', 'Son durum; değişmez', 'Genel Müdür Yardımcısı', '{}'::text[], false, false, NULL, NULL),
  ('ag_gelistirme_onerisi', 'Reddedildi', 'Kayıt yetkili makam tarafından kabul edilmedi; kayıt sonuç doğurmaz, gerekçe kayıtlıdır.', 'Genel Müdür Yardımcısı reddedince', 'Son durum; değişmez', 'Genel Müdür Yardımcısı', '{}'::text[], true, false, NULL, NULL),
  ('ag_gelistirme_onerisi', 'İade Edildi', 'Kayıt eksik veya düzeltme gerekçesiyle hazırlayana geri gönderildi.', 'Genel Müdür Yardımcısı gerekçeyle iade edince', 'Direktör düzeltilmiş öneriyi yeni kayıt olarak gönderir', 'Bilgi Teknolojileri ve Firma Yönetimi Direktörü', '{}'::text[], true, false, NULL, NULL);
