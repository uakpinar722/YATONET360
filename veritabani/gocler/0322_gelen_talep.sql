-- YG-1543, YG-1554, YG-1508 (K-211, D-054): web formu ve kayıtsız kanallardan gelen talep; konuya göre yönlendirme.
CREATE SEQUENCE gelen_talep_no;
CREATE TABLE gelen_talep (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), talep_no text NOT NULL UNIQUE,
  kanal text NOT NULL CHECK (kanal IN ('Web Formu', 'E-posta', 'Telefon', 'WhatsApp')),
  konu text NOT NULL, ad_soyad text NOT NULL, e_posta text, telefon text, mesaj text NOT NULL, dosya_no text,
  durum text NOT NULL DEFAULT 'Yönlendirme bekliyor' CHECK (durum IN ('Yönlendirme bekliyor', 'Yönlendirildi', 'Kapatıldı')),
  yonlenen_rol text, yonlendiren_ref text REFERENCES kullanici_hesabi (kimlik), adres text,
  olusturma_zamani timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON gelen_talep TO yatonet_uygulama;
GRANT USAGE ON SEQUENCE gelen_talep_no TO yatonet_uygulama;
