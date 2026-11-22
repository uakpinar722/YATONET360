-- YG-1354: uzun süren ve zamanlanmış işlerin genel iş kaydı.
CREATE TABLE arka_plan_isi (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), tur text NOT NULL, kaynak text NOT NULL CHECK (kaynak IN ('Zamanlanmış', 'Kullanıcı')),
  baslatan_ref text REFERENCES kullanici_hesabi (kimlik), nesne_turu text, nesne_kimligi text, baslangic timestamptz NOT NULL DEFAULT now(), bitis timestamptz,
  deneme integer NOT NULL DEFAULT 1 CHECK (deneme > 0), sonuc text NOT NULL DEFAULT 'Sürüyor' CHECK (sonuc IN ('Sürüyor', 'Tamamlandı', 'Hata')),
  etkilenen_kayit integer CHECK (etkilenen_kayit >= 0), hata text, iliski_kimligi text,
  CHECK ((sonuc = 'Sürüyor') = (bitis IS NULL))
);
CREATE INDEX arka_plan_isi_zaman ON arka_plan_isi (baslangic DESC);
CREATE INDEX arka_plan_isi_suruyor ON arka_plan_isi (tur) WHERE sonuc = 'Sürüyor';
GRANT SELECT, INSERT, UPDATE, DELETE ON arka_plan_isi TO yatonet_uygulama;
INSERT INTO durum_sozlugu (kayit_turu, durum, is_anlami, giris_kosulu, cikis_kosulu, yetkili_rol, izinli_gecisler, zorunlu_aciklama, sure_durur, otomatik_bildirim, musteri_adi) VALUES
  ('Arka Plan İşi', 'Sürüyor', 'İş çalışıyor; bitince sonucu yazılır.', 'İş başlatıldı.', 'İş bitti veya hata verdi.', 'Sistem', ARRAY['Tamamlandı', 'Hata'], false, false, false, NULL),
  ('Arka Plan İşi', 'Tamamlandı', 'İş sonuçlandı; etkilenen kayıt sayısı yazıldı.', 'İş hatasız bitti.', 'Yok', 'Sistem', '{}'::text[], false, false, true, NULL),
  ('Arka Plan İşi', 'Hata', 'İş hata verdi; hata özeti yazıldı.', 'İş hata verdi.', 'Yok', 'Sistem', '{}'::text[], false, false, true, NULL)
ON CONFLICT DO NOTHING;
