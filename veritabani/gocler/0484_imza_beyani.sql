-- YG-223, YG-1406 (V-1111): iç tutanak, tebliğ, kontrol listesi, zimmet ve devir tutanağı YATONET 360 onayıyla; sistem erişimi yoksa ıslak imza istisnası.
CREATE TABLE imza_beyani (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  belge_turu text NOT NULL CHECK (belge_turu IN ('İç Tutanak', 'Tebliğ', 'Kontrol Listesi', 'Zimmet', 'Devir Tutanağı')),
  konu text NOT NULL CHECK (length(trim(konu)) > 0), icerik text NOT NULL CHECK (length(trim(icerik)) > 0),
  kisi_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), dosya_ref uuid REFERENCES dosya (kimlik),
  hazirlayan_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), olusturma_zamani timestamptz NOT NULL DEFAULT now(),
  durum text NOT NULL DEFAULT 'Onay Bekliyor' CHECK (durum IN ('Onay Bekliyor', 'Onaylandı', 'Islak İmzalı')),
  sonuc_zamani timestamptz, onay_oturumu text, islak_belge_ref uuid REFERENCES belge (kimlik), islak_gerekce text,
  CHECK (kisi_ref <> hazirlayan_ref),
  CHECK ((durum = 'Islak İmzalı') = (islak_belge_ref IS NOT NULL AND islak_gerekce IS NOT NULL))
);
GRANT SELECT, INSERT, UPDATE ON imza_beyani TO yatonet_uygulama;
INSERT INTO durum_sozlugu (kayit_turu, durum, is_anlami, giris_kosulu, cikis_kosulu, yetkili_rol, izinli_gecisler, zorunlu_aciklama, sure_durur, otomatik_bildirim, musteri_adi) VALUES
  ('imza_beyani', 'Onay Bekliyor', 'Kayıt hazırlandı, yetkili makamın onayını bekliyor.', 'LGM personeli belge türü, konu, içerik ve onaylayacak kişiyle kaydı açınca', 'Kişi YATONET 360 onayı verince Onaylandı; kişinin sistem erişimi yoksa hazırlayan ıslak imzalı belgeyi gerekçesiyle yükleyince Islak İmzalı', 'Belgedeki kişi', ARRAY['Onaylandı', 'Islak İmzalı'], false, false, 'Belge Onayı görevi', NULL),
  ('imza_beyani', 'Onaylandı', 'Kayıt son yetkili makam tarafından kabul edildi ve sonuç doğurur.', 'Belgedeki kişi kendi oturumundan onaylayınca', 'Yok', 'Belgedeki kişi', '{}'::text[], false, false, NULL, NULL),
  ('imza_beyani', 'Islak İmzalı', 'Kişinin sistem erişimi olmadığından belge ıslak imzayla alındı; taranmış belge ve gerekçe kayıtlı.', 'Hazırlayan ıslak imzalı taranmış belgeyi ve gerekçeyi yükleyince', 'Yok', 'Hazırlayan', '{}'::text[], true, false, NULL, NULL)
ON CONFLICT DO NOTHING;
