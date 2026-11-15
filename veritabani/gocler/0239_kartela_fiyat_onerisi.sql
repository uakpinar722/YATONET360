-- YG-856: kartela fiyat güncelleme önerisi (Tedarik veya Teknik birim önerir, Ticari İşler Direktörü onaylar).
CREATE TABLE kartela_fiyat_onerisi (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kod text NOT NULL, maliyet_eur numeric(14,2) NOT NULL CHECK (maliyet_eur > 0), maliyet_tarihi date NOT NULL, kaynak text NOT NULL, gerekce text NOT NULL,
  durum text NOT NULL DEFAULT 'Onayda' CHECK (durum IN ('Onayda', 'Taslak Bekliyor', 'Taslağa İşlendi', 'Reddedildi')),
  islenen_surum text, oneren_ref text NOT NULL, olusturma_zamani timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON kartela_fiyat_onerisi TO yatonet_uygulama;
INSERT INTO durum_sozlugu (kayit_turu, durum, is_anlami, giris_kosulu, cikis_kosulu, yetkili_rol, izinli_gecisler, zorunlu_aciklama, sure_durur, otomatik_bildirim, musteri_adi) VALUES
  ('kartela_fiyat_onerisi', 'Onayda', 'Kayıt onay zincirinde, sıradaki makamın kararını bekliyor; içerik değiştirilemez.', 'Tedarik veya Teknik birim fiyat güncellemesi önerince', 'Ticari İşler Direktörü onaylarsa Taslağa İşlendi veya Taslak Bekliyor, reddederse Reddedildi', 'Ticari İşler Direktörü', ARRAY['Taslak Bekliyor', 'Taslağa İşlendi', 'Reddedildi']::text[], false, false, 'Ticari İşler Direktörüne onay kartı', NULL),
  ('kartela_fiyat_onerisi', 'Taslak Bekliyor', 'Onaylanan fiyat açık taslak kartela sürümü olmadığı için bekliyor; taslak açılınca işlenir.', 'Onay anında taslak sürüm yoksa', 'Taslak sürüm açılınca Taslağa İşlendi', 'Ticari İşler Direktörü', ARRAY['Taslağa İşlendi']::text[], false, false, NULL, NULL),
  ('kartela_fiyat_onerisi', 'Taslağa İşlendi', 'Onaylanan fiyat taslak kartela sürümüne yazıldı; sürüm CEO onayıyla yürürlüğe girer.', 'Onayda taslak varsa veya taslak açılınca', 'Son durum', 'Ticari İşler Direktörü', ARRAY[]::text[], false, false, NULL, NULL),
  ('kartela_fiyat_onerisi', 'Reddedildi', 'Kayıt yetkili makam tarafından kabul edilmedi; kayıt sonuç doğurmaz, gerekçe kayıtlıdır.', 'Ticari İşler Direktörü reddedince', 'Son durum', 'Ticari İşler Direktörü', ARRAY[]::text[], true, false, NULL, NULL)
ON CONFLICT DO NOTHING;
