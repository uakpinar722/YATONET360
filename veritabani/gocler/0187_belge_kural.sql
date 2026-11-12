-- YG-605, YG-603: tür bazlı zorunlu bilgi ve dış kapalılık; YG-604: sınır önerisi; YG-602: karantina.
CREATE TABLE belge_turu_kurali (
  belge_turu text PRIMARY KEY, zorunlu_alanlar text[] NOT NULL DEFAULT '{}', dis_kapali_gruplar text[] NOT NULL DEFAULT '{}',
  guncelleyen_ref text REFERENCES kullanici_hesabi (kimlik), zaman timestamptz NOT NULL DEFAULT now()
);
INSERT INTO belge_turu_kurali (belge_turu, zorunlu_alanlar) VALUES
 ('Fotoğraf', ARRAY['belge_tarihi', 'kaynak_kisi']), ('Teslim Kanıtı', ARRAY['belge_tarihi', 'kaynak_kisi']), ('Onay', ARRAY['belge_tarihi', 'kaynak_kisi']),
 ('Sözleşme', ARRAY['belge_tarihi']), ('Fatura', ARRAY['belge_tarihi']), ('Teknik Rapor', ARRAY['belge_tarihi']), ('Fiyat Teklifi', ARRAY['belge_tarihi']), ('Kontrol Formu', ARRAY['belge_tarihi']);
CREATE TABLE dosya_siniri_onerisi (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), grup text NOT NULL, uzantilar text[] NOT NULL, azami_bayt bigint NOT NULL CHECK (azami_bayt > 0), gerekce text NOT NULL,
  durum text NOT NULL DEFAULT 'Onayda' CHECK (durum IN ('Onayda', 'Onaylandı', 'Reddedildi')),
  oneren_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), karar_veren_ref text REFERENCES kullanici_hesabi (kimlik), karar_zamani timestamptz, olusturma_zamani timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE belge_surum DROP CONSTRAINT belge_surum_durum_check;
ALTER TABLE belge_surum ADD CONSTRAINT belge_surum_durum_check CHECK (durum IN ('Taslak', 'İncelemede', 'Onaylı', 'Yürürlükte', 'Arşiv', 'Yerine Geçti', 'İptal', 'Karantina'));
GRANT UPDATE (tarama_kaynagi) ON belge_surum TO yatonet_uygulama;
GRANT SELECT, INSERT, UPDATE ON belge_turu_kurali, dosya_siniri_onerisi TO yatonet_uygulama;
GRANT INSERT, UPDATE ON dosya_siniri TO yatonet_uygulama;
INSERT INTO durum_sozlugu (kayit_turu, durum, is_anlami, giris_kosulu, cikis_kosulu, yetkili_rol, izinli_gecisler, zorunlu_aciklama, sure_durur, otomatik_bildirim, musteri_adi) VALUES
 ('belge_surum', 'Karantina', 'Kayıt şüpheli bulunduğu için ayrıldı; inceleme bitmeden kullanılmaz.', 'Yüklemede zararlı içerik taraması tamamlanamayınca', 'Yeniden taramada temizse Taslak, zararlıysa İptal', 'Bilgi İşlem Müdürü', ARRAY['Taslak', 'İptal']::text[], false, false, NULL, NULL),
 ('dosya_siniri_onerisi', 'Onayda', 'Kayıt onay zincirinde, sıradaki makamın kararını bekliyor; içerik değiştirilemez.', 'Bilgi İşlem Müdürü önerince', 'BT ve Firma Yönetimi Direktörü onaylarsa Onaylandı, reddederse Reddedildi', 'Bilgi Teknolojileri ve Firma Yönetimi Direktörü', ARRAY['Onaylandı', 'Reddedildi']::text[], false, false, 'Direktöre onay kartı', NULL),
 ('dosya_siniri_onerisi', 'Onaylandı', 'Kayıt son yetkili makam tarafından kabul edildi ve sonuç doğurur.', 'Direktör onaylayınca', 'Son durum', 'Bilgi Teknolojileri ve Firma Yönetimi Direktörü', '{}'::text[], false, false, NULL, NULL),
 ('dosya_siniri_onerisi', 'Reddedildi', 'Kayıt yetkili makamca kabul edilmedi; sonuç doğurmaz.', 'Direktör reddedince', 'Son durum', 'Bilgi Teknolojileri ve Firma Yönetimi Direktörü', '{}'::text[], true, false, NULL, NULL);
