-- YG-1499: müşteriye iade kaydı.
CREATE TABLE iade_kaydi (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dosya_ref uuid NOT NULL REFERENCES dosya (kimlik),
  neden text NOT NULL CHECK (neden IN ('Avans İadesi', 'Fazla Ödeme', 'İtiraz Sonucu İade')),
  tutar numeric(14,2) NOT NULL CHECK (tutar > 0), para_birimi text NOT NULL CHECK (para_birimi IN ('EUR', 'TL')),
  iade_tarihi date NOT NULL, odeme_araci text NOT NULL, aciklama text,
  durum text NOT NULL DEFAULT 'Onayda' CHECK (durum IN ('Onayda', 'Onaylandı', 'Reddedildi')),
  hazirlayan_ref text NOT NULL, olusturma_zamani timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON iade_kaydi TO yatonet_uygulama;
INSERT INTO durum_sozlugu (kayit_turu, durum, is_anlami, giris_kosulu, cikis_kosulu, yetkili_rol, izinli_gecisler, zorunlu_aciklama, sure_durur, otomatik_bildirim, musteri_adi) VALUES
  ('iade_kaydi', 'Onayda', 'Kayıt onay zincirinde, sıradaki makamın kararını bekliyor; içerik değiştirilemez.', 'Ticari Sorumlu iade kaydını hazırlayınca', 'Ticari İşler Direktörü onaylarsa Onaylandı, reddederse Reddedildi', 'Ticari İşler Direktörü', ARRAY['Onaylandı', 'Reddedildi']::text[], false, false, 'Ticari İşler Direktörüne onay kartı', NULL),
  ('iade_kaydi', 'Onaylandı', 'Kayıt son yetkili makam tarafından kabul edildi ve sonuç doğurur.', 'Ticari İşler Direktörü onaylayınca', 'Son durum; BLD-47 iade bildirimi yat sahibine gider', 'Ticari İşler Direktörü', ARRAY[]::text[], false, false, 'BLD-47 iade bildirimi', NULL),
  ('iade_kaydi', 'Reddedildi', 'Kayıt yetkili makam tarafından kabul edilmedi; kayıt sonuç doğurmaz, gerekçe kayıtlıdır.', 'Ticari İşler Direktörü reddedince', 'Son durum', 'Ticari İşler Direktörü', ARRAY[]::text[], true, false, NULL, NULL)
ON CONFLICT DO NOTHING;
