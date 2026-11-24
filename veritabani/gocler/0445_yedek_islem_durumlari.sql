-- YG-1277: yedek işlem talebi durumları durum sözlüğünde.
INSERT INTO durum_sozlugu (kayit_turu, durum, is_anlami, giris_kosulu, cikis_kosulu, yetkili_rol, izinli_gecisler, zorunlu_aciklama, sure_durur, otomatik_bildirim, musteri_adi) VALUES
  ('yedek_islem_talebi', 'Onay Bekliyor', 'Kayıt hazırlandı, yetkili makamın onayını bekliyor.', 'Sistem Yöneticisi veya Bilgi İşlem Müdürü işlem ve gerekçeyle talep açınca', 'Bilgi İşlem Müdürü ve BT ve Firma Yönetimi Direktörü kararıyla Onaylandı veya Reddedildi', 'Bilgi Teknolojileri ve Firma Yönetimi Direktörü', ARRAY['Onaylandı', 'Reddedildi'], false, false, 'Onay kartı', NULL),
  ('yedek_islem_talebi', 'Onaylandı', 'Kayıt son yetkili makam tarafından kabul edildi ve sonuç doğurur.', 'Direktör onaylayınca', 'Yok', 'Bilgi Teknolojileri ve Firma Yönetimi Direktörü', '{}'::text[], false, false, NULL, NULL),
  ('yedek_islem_talebi', 'Reddedildi', 'Kayıt yetkili makam tarafından kabul edilmedi; kayıt sonuç doğurmaz, gerekçe kayıtlıdır.', 'Onay zincirinde reddedilince', 'Yok', 'Bilgi Teknolojileri ve Firma Yönetimi Direktörü', '{}'::text[], true, false, NULL, NULL)
ON CONFLICT DO NOTHING;
