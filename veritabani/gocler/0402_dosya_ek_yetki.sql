-- YG-995: dosya bazlı süreli ek erişim; Operasyon Müdürü onaylar, bitiş zamanında kendiliğinden düşer.
CREATE TABLE dosya_ek_yetki (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), dosya_ref uuid NOT NULL REFERENCES dosya (kimlik), kullanici_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik),
  gerekce text NOT NULL CHECK (length(btrim(gerekce)) > 0), bitis timestamptz NOT NULL, durum text NOT NULL DEFAULT 'Onayda' CHECK (durum IN ('Onayda', 'Aktif', 'Reddedildi', 'Kaldırıldı')),
  talep_eden_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), onaylayan_ref text REFERENCES kullanici_hesabi (kimlik), olusturma_zamani timestamptz NOT NULL DEFAULT now(),
  CHECK (bitis > olusturma_zamani)
);
CREATE INDEX dosya_ek_yetki_k ON dosya_ek_yetki (kullanici_ref, dosya_ref) WHERE durum = 'Aktif';
GRANT SELECT, INSERT, UPDATE ON dosya_ek_yetki TO yatonet_uygulama;
INSERT INTO durum_sozlugu (kayit_turu, durum, is_anlami, giris_kosulu, cikis_kosulu, yetkili_rol, izinli_gecisler, zorunlu_aciklama, sure_durur, otomatik_bildirim, musteri_adi) VALUES
  ('dosya_ek_yetki', 'Onayda', 'Kayıt onay zincirinde, sıradaki makamın kararını bekliyor; içerik değiştirilemez.', 'Dosya ekibi süreli ek erişim talep edince', 'Operasyon Müdürü onaylayınca Aktif, reddedince Reddedildi', 'Operasyon Müdürü', ARRAY['Aktif','Reddedildi']::text[], false, false, NULL, NULL),
  ('dosya_ek_yetki', 'Aktif', 'Kayıt yürürlükte ve kullanılıyor.', 'Operasyon Müdürü onaylayınca', 'Bitiş zamanında erişim kendiliğinden düşer; erken kaldırılınca Kaldırıldı', 'Operasyon Müdürü', ARRAY['Kaldırıldı']::text[], false, false, NULL, NULL),
  ('dosya_ek_yetki', 'Reddedildi', 'Kayıt yetkili makam tarafından kabul edilmedi; kayıt sonuç doğurmaz, gerekçe kayıtlıdır.', 'Operasyon Müdürü reddedince', 'Son durum; değişmez', 'Operasyon Müdürü', '{}'::text[], true, false, NULL, NULL),
  ('dosya_ek_yetki', 'Kaldırıldı', 'Ek erişim süresinden önce kaldırıldı; erişim sona erdi.', 'Operasyon Müdürü veya talep eden erken kaldırınca', 'Son durum; değişmez', 'Operasyon Müdürü', '{}'::text[], true, false, NULL, NULL);
