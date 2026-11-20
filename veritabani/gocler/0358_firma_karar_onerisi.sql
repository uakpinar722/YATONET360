-- YG-1650 (A37): başvuru ön incelemesi (karara sunma 15 iş günü), kanıta bağlı puanlama ve karar önerisi; "Onaya Gönder" → Firma Yönetimi Müdür Yardımcısı → Firma Yönetimi Müdürü.
ALTER TABLE kurulus ADD COLUMN on_inceleme_son timestamptz;
CREATE TABLE firma_karar_onerisi (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), kurulus_ref uuid NOT NULL REFERENCES kurulus (kimlik),
  oneri text NOT NULL CHECK (oneri IN ('Onaylı', 'Koşullu Onaylı', 'İncelemede', 'Reddedildi')),
  kapsama text CHECK (kapsama IN ('Bölge', 'Komşu', 'Mobil Ekip', 'Ulusal')), puanlar jsonb NOT NULL DEFAULT '[]', gerekce text NOT NULL,
  durum text NOT NULL DEFAULT 'Onayda' CHECK (durum IN ('Onayda', 'Onaylandı', 'Reddedildi', 'İade Edildi')),
  hazirlayan_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), karar_veren_ref text REFERENCES kullanici_hesabi (kimlik), karar_zamani timestamptz,
  olusturma_zamani timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX firma_karar_onerisi_tek ON firma_karar_onerisi (kurulus_ref) WHERE durum = 'Onayda';
GRANT SELECT, INSERT, UPDATE ON firma_karar_onerisi TO yatonet_uygulama;
INSERT INTO durum_sozlugu (kayit_turu, durum, is_anlami, giris_kosulu, cikis_kosulu, yetkili_rol, izinli_gecisler, zorunlu_aciklama, sure_durur, otomatik_bildirim, musteri_adi) VALUES
  ('firma_karar_onerisi', 'Onayda', 'Kayıt onay zincirinde, sıradaki makamın kararını bekliyor; içerik değiştirilemez.', 'Firma Yönetimi Yöneticisi puanlı karar önerisini "Onaya Gönder" ile gönderince', 'Firma Yönetimi Müdürü onaylayınca Onaylandı; retle Reddedildi; iadeyle İade Edildi', 'Firma Yönetimi Müdürü', ARRAY['Onaylandı','Reddedildi','İade Edildi']::text[], false, false, 'Firma Yönetimi Müdür Yardımcısına onay kartı', NULL),
  ('firma_karar_onerisi', 'Onaylandı', 'Kayıt son yetkili makam tarafından kabul edildi ve sonuç doğurur.', 'Firma Yönetimi Müdürü onayı', 'Son durum; firmanın kayıt aşaması öneriye göre güncellenir', 'Firma Yönetimi Müdürü', '{}'::text[], false, false, NULL, NULL),
  ('firma_karar_onerisi', 'Reddedildi', 'Kayıt yetkili makam tarafından kabul edilmedi; kayıt sonuç doğurmaz, gerekçe kayıtlıdır.', 'Reddet', 'Son durum; yeni öneri ayrı hazırlanır', 'Firma Yönetimi Müdürü', '{}'::text[], true, false, NULL, NULL),
  ('firma_karar_onerisi', 'İade Edildi', 'Kayıt eksik veya düzeltme gerekçesiyle hazırlayana geri gönderildi.', 'Gerekçeyle İade Et', 'Firma Yönetimi Yöneticisi yeni öneri hazırlar', 'Firma Yönetimi Müdür Yardımcısı', '{}'::text[], true, false, NULL, NULL)
ON CONFLICT DO NOTHING;
