-- YG-996: yetki matrisi işlev veya risk değişiminde gerekçeli talep ve onayla güncellenir; kaldırılan izin kurulumda geri eklenmez.
CREATE TABLE yetki_matrisi_talebi (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), rol_ref text NOT NULL REFERENCES rol (kimlik), izin text NOT NULL, islem text NOT NULL CHECK (islem IN ('Ekle', 'Kaldır')),
  risk text NOT NULL CHECK (risk IN ('Düşük', 'Orta', 'Yüksek')), gerekce text NOT NULL, durum text NOT NULL DEFAULT 'Onay Bekliyor' CHECK (durum IN ('Onay Bekliyor', 'Onaylandı', 'Reddedildi')),
  hazirlayan_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), olusturma_zamani timestamptz NOT NULL DEFAULT now(), karar_zamani timestamptz
);
CREATE TABLE rol_izni_kaldirilan (rol_ref text NOT NULL REFERENCES rol (kimlik), izin text NOT NULL, talep_ref uuid NOT NULL REFERENCES yetki_matrisi_talebi (kimlik), zaman timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (rol_ref, izin));
GRANT SELECT, INSERT, UPDATE ON yetki_matrisi_talebi TO yatonet_uygulama;
GRANT SELECT, INSERT, DELETE ON rol_izni_kaldirilan TO yatonet_uygulama;
GRANT INSERT, DELETE ON rol_izni TO yatonet_uygulama;
INSERT INTO durum_sozlugu (kayit_turu, durum, is_anlami, giris_kosulu, cikis_kosulu, yetkili_rol, izinli_gecisler, zorunlu_aciklama, sure_durur, otomatik_bildirim, musteri_adi) VALUES
  ('yetki_matrisi_talebi', 'Onay Bekliyor', 'Kayıt hazırlandı, yetkili makamın onayını bekliyor.', 'Sistem Yöneticisi veya Bilgi İşlem Müdürü rol, izin, işlem, risk ve gerekçeyle talep hazırlayınca', 'Rolün onay makamı ve BT ve Firma Yönetimi Direktörü kararıyla Onaylandı veya Reddedildi', 'Bilgi Teknolojileri ve Firma Yönetimi Direktörü', ARRAY['Onaylandı', 'Reddedildi'], false, false, 'Onay kartı', NULL),
  ('yetki_matrisi_talebi', 'Onaylandı', 'Kayıt son yetkili makam tarafından kabul edildi ve sonuç doğurur.', 'Direktör onaylayınca; izin matrise eklenir veya matristen kaldırılır', 'Yok', 'Bilgi Teknolojileri ve Firma Yönetimi Direktörü', '{}'::text[], false, false, NULL, NULL),
  ('yetki_matrisi_talebi', 'Reddedildi', 'Kayıt yetkili makam tarafından kabul edilmedi; kayıt sonuç doğurmaz, gerekçe kayıtlıdır.', 'Onay zincirinde reddedilince', 'Yok', 'Bilgi Teknolojileri ve Firma Yönetimi Direktörü', '{}'::text[], true, false, NULL, NULL)
ON CONFLICT DO NOTHING;
