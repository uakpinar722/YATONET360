-- YG-600, YG-626: metin kütüphanesinde sahip, onay dayanağı, değişiklik gerekçesi ve sürüm durumları.
ALTER TABLE sablon_metni ADD COLUMN sahip_rol text NOT NULL DEFAULT 'Bilgi Teknolojileri ve Firma Yönetimi Direktörü', ADD COLUMN onay_dayanagi text, ADD COLUMN degisiklik_gerekcesi text,
  ADD COLUMN hazirlayan_ref text REFERENCES kullanici_hesabi (kimlik), ADD COLUMN onaylayan_ref text REFERENCES kullanici_hesabi (kimlik), ADD COLUMN yayim_zamani timestamptz;
UPDATE sablon_metni SET onay_dayanagi = 'CEO onaylı metin kütüphanesi (kurulum)' WHERE onay_dayanagi IS NULL;
ALTER TABLE sablon_metni ADD CONSTRAINT sablon_metni_durum CHECK (durum IN ('Taslak', 'Onayda', 'Yürürlükte', 'Yerine Geçti'));
GRANT INSERT, UPDATE ON sablon_metni TO yatonet_uygulama;
INSERT INTO durum_sozlugu (kayit_turu, durum, is_anlami, giris_kosulu, cikis_kosulu, yetkili_rol, izinli_gecisler, zorunlu_aciklama, sure_durur, otomatik_bildirim, musteri_adi) VALUES
 ('sablon_metni', 'Taslak', 'Kayıt hazırlanıyor; henüz gönderilmedi ve sonuç doğurmaz.', 'CEO iade edince', 'Hazırlayan yeniden gönderince Onayda', 'Bilgi Teknolojileri ve Firma Yönetimi Direktörü', ARRAY['Onayda']::text[], false, false, NULL, NULL),
 ('sablon_metni', 'Onayda', 'Kayıt onay zincirinde, sıradaki makamın kararını bekliyor; içerik değiştirilemez.', 'Anlamı etkileyen yeni sürüm kaydedilince', 'CEO onaylarsa Yürürlükte, iade ederse Taslak', 'CEO', ARRAY['Yürürlükte', 'Taslak']::text[], true, false, 'CEO''ya onay kartı', NULL),
 ('sablon_metni', 'Yürürlükte', 'Kayıt onaylanmış ve geçerlilik süresi içinde uygulanıyor.', 'CEO onayıyla veya yazım düzeltmesinde metin sahibi kaydıyla', 'Yeni sürüm yürürlüğe girince Yerine Geçti', 'CEO', ARRAY['Yerine Geçti']::text[], false, false, NULL, NULL),
 ('sablon_metni', 'Yerine Geçti', 'Kaydın yeni sürümü yürürlüğe girdi; bu sürüm yalnız geçmiş için saklanır.', 'Yeni sürüm yürürlüğe girince', 'Son durum', 'Bilgi Teknolojileri ve Firma Yönetimi Direktörü', '{}'::text[], false, false, NULL, NULL);
