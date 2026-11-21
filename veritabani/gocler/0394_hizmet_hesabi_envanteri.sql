-- YG-1000: sistem/entegrasyon hizmet hesabı envanteri; yalnız "Sistem/Hizmet Hesabı" grubundaki hesap kaydedilir. Sahip rol, amaç, eriştiği veri,
-- anahtar/sertifika ve bitişi, kaynak adres, çalışma zamanı, kapanış yöntemi ve çağıran entegrasyon tutulur.
CREATE TABLE hizmet_hesabi_envanteri (
  kullanici_ref text PRIMARY KEY REFERENCES kullanici_hesabi (kimlik), sahip_rol_ref text NOT NULL REFERENCES rol (kimlik),
  amac text NOT NULL CHECK (length(btrim(amac)) > 0), eristigi_veri text NOT NULL CHECK (length(btrim(eristigi_veri)) > 0),
  anahtar_turu text NOT NULL CHECK (anahtar_turu IN ('API Anahtarı', 'Sertifika')), anahtar_bitis date NOT NULL,
  kaynak_adres text NOT NULL, calisma_zamani text NOT NULL, kapanis_yontemi text NOT NULL, entegrasyon_ref uuid REFERENCES entegrasyon_tanimi (kimlik),
  son_kullanim timestamptz, durum text NOT NULL DEFAULT 'Aktif' CHECK (durum IN ('Aktif', 'Askıda', 'Kapalı')), askiya_alma_nedeni text,
  bilgi_sinifi text NOT NULL DEFAULT 'Gizli' CONSTRAINT hizmet_hesabi_envanteri_bilgi_sinifi_kisisel CHECK (bilgi_sinifi IN ('Kurumsal', 'Gizli', 'Kritik')),
  kaydeden_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), olusturma_zamani timestamptz NOT NULL DEFAULT now()
);
CREATE FUNCTION hizmet_hesabi_grubu() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM kullanici_hesabi WHERE kimlik = NEW.kullanici_ref AND kullanici_grubu = 'Sistem/Hizmet Hesabı') THEN
    RAISE EXCEPTION 'Envantere yalnız Sistem/Hizmet Hesabı grubundaki hesap kaydedilir.';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER hizmet_hesabi_grubu BEFORE INSERT OR UPDATE OF kullanici_ref ON hizmet_hesabi_envanteri FOR EACH ROW EXECUTE FUNCTION hizmet_hesabi_grubu();
GRANT SELECT, INSERT, UPDATE ON hizmet_hesabi_envanteri TO yatonet_uygulama;
INSERT INTO durum_sozlugu (kayit_turu, durum, is_anlami, giris_kosulu, cikis_kosulu, yetkili_rol, izinli_gecisler, zorunlu_aciklama, sure_durur, otomatik_bildirim, musteri_adi) VALUES
  ('hizmet_hesabi_envanteri', 'Aktif', 'Kayıt yürürlükte ve kullanılıyor.', 'Bilgi İşlem hizmet hesabını envantere kaydedince', 'Kullanılmayınca veya çağıran entegrasyon kapanınca Askıda', 'Bilgi İşlem Müdürü', ARRAY['Askıda','Kapalı']::text[], false, false, NULL, NULL),
  ('hizmet_hesabi_envanteri', 'Askıda', 'Kayıt geçici olarak durduruldu; askı kalkana kadar işlem yapılmaz.', '90 gün kullanılmayınca veya çağıran entegrasyon askıya alınınca ya da kapanınca', 'Bilgi İşlem çağıran sistemi doğrulayınca Aktif veya kapanış yöntemiyle Kapalı', 'Bilgi İşlem Müdürü', ARRAY['Aktif','Kapalı']::text[], false, false, 'Sahip role görev', NULL),
  ('hizmet_hesabi_envanteri', 'Kapalı', 'Kayıt kapanış koşulları sağlanarak sonuçlandırıldı; yeni işlem yapılmaz.', 'Kapanış yöntemi uygulanınca', 'Son durum; değişmez', 'Bilgi İşlem Müdürü', '{}'::text[], false, false, NULL, NULL);
