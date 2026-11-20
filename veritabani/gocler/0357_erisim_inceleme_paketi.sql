-- YG-1645 (A34): üç aylık ayrıcalıklı hesap erişim inceleme paketi Bilgi İşlem Müdür Yardımcısınca hazırlanır, "Onaya Gönder" ile Bilgi İşlem Müdürüne gider.
ALTER TABLE erisim_inceleme ADD COLUMN paket boolean NOT NULL DEFAULT false, ADD COLUMN hazirlayan_ref text REFERENCES kullanici_hesabi (kimlik);
ALTER TABLE erisim_inceleme DROP CONSTRAINT erisim_inceleme_durum_check;
ALTER TABLE erisim_inceleme ADD CONSTRAINT erisim_inceleme_durum_check CHECK (durum IN ('Açık', 'Onayda', 'Tamamlandı'));
ALTER TABLE erisim_inceleme_kalemi ADD COLUMN oneri text CHECK (oneri IN ('Koru', 'Daralt', 'Süre Uzat', 'Askıya Al', 'Kapat')), ADD COLUMN oneri_gerekce text, ADD COLUMN oneri_bitis date;
INSERT INTO durum_sozlugu (kayit_turu, durum, is_anlami, giris_kosulu, cikis_kosulu, yetkili_rol, izinli_gecisler, zorunlu_aciklama, sure_durur, otomatik_bildirim, musteri_adi) VALUES
  ('erisim_inceleme', 'Onayda', 'Kayıt onay zincirinde, sıradaki makamın kararını bekliyor; içerik değiştirilemez.', 'Bilgi İşlem Müdür Yardımcısı tüm kalemlere öneri yazıp paketi "Onaya Gönder" ile gönderince', 'Bilgi İşlem Müdürü onaylayınca öneriler uygulanır ve Tamamlandı; iade veya retle Açık', 'Bilgi İşlem Müdürü', ARRAY['Tamamlandı','Açık']::text[], false, false, 'Bilgi İşlem Müdürüne onay kartı', NULL)
ON CONFLICT DO NOTHING;
