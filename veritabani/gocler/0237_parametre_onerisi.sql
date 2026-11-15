-- YG-853: parametre değişikliği önerisi (TİD öneri, GMY görüş, CEO onay).
CREATE TABLE parametre_onerisi (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kod text NOT NULL REFERENCES sistem_parametresi (kod),
  eski numeric, yeni numeric, gerekce text NOT NULL,
  durum text NOT NULL DEFAULT 'Onayda' CHECK (durum IN ('Onayda', 'Onaylandı', 'Reddedildi')),
  oneren_ref text NOT NULL, olusturma_zamani timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON parametre_onerisi TO yatonet_uygulama;
INSERT INTO durum_sozlugu (kayit_turu, durum, is_anlami, giris_kosulu, cikis_kosulu, yetkili_rol, izinli_gecisler, zorunlu_aciklama, sure_durur, otomatik_bildirim, musteri_adi) VALUES
  ('parametre_onerisi', 'Onayda', 'Kayıt onay zincirinde, sıradaki makamın kararını bekliyor; içerik değiştirilemez.', 'Ticari İşler Direktörü değişikliği önerince', 'CEO onaylarsa Onaylandı, reddederse Reddedildi', 'CEO', ARRAY['Onaylandı', 'Reddedildi']::text[], false, false, 'Genel Müdür Yardımcısına onay kartı', NULL),
  ('parametre_onerisi', 'Onaylandı', 'Kayıt son yetkili makam tarafından kabul edildi ve sonuç doğurur.', 'CEO onaylayınca', 'Son durum; yeni değer yürürlüğe girer', 'CEO', ARRAY[]::text[], false, false, NULL, NULL),
  ('parametre_onerisi', 'Reddedildi', 'Kayıt yetkili makam tarafından kabul edilmedi; kayıt sonuç doğurmaz, gerekçe kayıtlıdır.', 'GMY veya CEO reddedince', 'Son durum', 'CEO', ARRAY[]::text[], true, false, NULL, NULL)
ON CONFLICT DO NOTHING;
