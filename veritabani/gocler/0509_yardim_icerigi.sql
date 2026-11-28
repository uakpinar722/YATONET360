-- YG-1502, YG-1503, YG-1581 (V-1150): Yardım sayfası ve Akademide eğitim videosu, rol videosu, sıkça sorulan sorular ve kılavuzlar.
-- İçerik Bilgi Teknolojileri ve Firma Yönetimi Direktörlüğünce güncellenir; sigorta şirketi kullanıcılarına video gösterilmez.
CREATE TABLE yardim_icerigi (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), tur text NOT NULL CHECK (tur IN ('Video', 'Sıkça Sorulan Soru', 'Kılavuz')),
  baslik text NOT NULL, metin text, dil text NOT NULL DEFAULT 'Türkçe' CHECK (dil IN ('Türkçe', 'İngilizce')), hedef text NOT NULL, sira integer NOT NULL DEFAULT 100,
  durum text NOT NULL DEFAULT 'Aktif' CHECK (durum IN ('Aktif', 'Pasif')), ekleyen_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), olusturma_zamani timestamptz NOT NULL DEFAULT now(),
  guncelleyen_ref text REFERENCES kullanici_hesabi (kimlik), guncelleme_zamani timestamptz
);
CREATE INDEX yardim_icerigi_hedef ON yardim_icerigi (hedef, tur) WHERE durum = 'Aktif';
GRANT SELECT, INSERT, UPDATE ON yardim_icerigi TO yatonet_uygulama;
INSERT INTO durum_sozlugu (kayit_turu, durum, is_anlami, giris_kosulu, cikis_kosulu, yetkili_rol, izinli_gecisler, zorunlu_aciklama, sure_durur, otomatik_bildirim, musteri_adi) VALUES
  ('yardim_icerigi', 'Aktif', 'Kayıt yürürlükte ve kullanılıyor.', 'Bilgi Teknolojileri ve Firma Yönetimi Direktörlüğü içeriği ekleyince', 'Yayından kaldırılınca Pasif', 'Bilgi Teknolojileri ve Firma Yönetimi Direktörü', ARRAY['Pasif'], false, false, NULL, NULL),
  ('yardim_icerigi', 'Pasif', 'Kayıt kullanım dışı; yeniden etkinleştirilmeden işlemde kullanılamaz.', 'Yayından kaldırılınca', 'Yeniden yayımlanınca Aktif', 'Bilgi Teknolojileri ve Firma Yönetimi Direktörü', ARRAY['Aktif'], false, false, NULL, NULL);
