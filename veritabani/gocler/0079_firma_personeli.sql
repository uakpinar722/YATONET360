-- YG-304, YG-424, YG-339: firma personeli kaydı (görev, İSG eğitimi ve yetki belgesi geçerliliği), görevlendirme uyarısı ve QR doğrulamalı Görevli Ekip Kartı.
CREATE TABLE IF NOT EXISTS firma_personeli (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), kurulus_ref uuid NOT NULL REFERENCES kurulus (kimlik), ad_soyad text NOT NULL CHECK (length(trim(ad_soyad)) > 0), gorev text NOT NULL CHECK (length(trim(gorev)) > 0),
  telefon text, kullanici_ref text REFERENCES kullanici_hesabi (kimlik), isg_egitim_bitis date, yetki_belgesi text, yetki_belgesi_bitis date,
  aktif boolean NOT NULL DEFAULT true, ayrilis_zamani timestamptz, giren_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), olusturma_zamani timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS firma_personeli_kurulus ON firma_personeli (kurulus_ref) WHERE aktif;
CREATE TABLE IF NOT EXISTS ekip_karti (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), kod text NOT NULL UNIQUE, personel_ref uuid NOT NULL REFERENCES firma_personeli (kimlik), is_emri_ref uuid NOT NULL REFERENCES is_emri (kimlik),
  gecerlilik_bitis date NOT NULL, iptal_zamani timestamptz, olusturma_zamani timestamptz NOT NULL DEFAULT now(), UNIQUE (personel_ref, is_emri_ref)
);
GRANT SELECT, INSERT, UPDATE ON firma_personeli, ekip_karti TO yatonet_uygulama;
