-- YG-937, YG-938, YG-943: Akademi dersleri ve beyan. YG-970: deneme süresi değerlendirmesi.
CREATE TABLE akademi_ders (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), ad text NOT NULL CHECK (length(trim(ad)) > 0), tur text NOT NULL CHECK (tur IN ('Zorunlu', 'Oryantasyon', 'Rol Müfredatı')), icerik text NOT NULL, roller text[] NOT NULL DEFAULT '{}', surum integer NOT NULL DEFAULT 1, degisiklik_notu text, aktif boolean NOT NULL DEFAULT true, olusturan_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), olusturma_zamani timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE akademi_beyan (ders_ref uuid NOT NULL REFERENCES akademi_ders (kimlik), surum integer NOT NULL, personel_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), beyan_zamani timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (ders_ref, surum, personel_ref));
CREATE TABLE deneme_degerlendirme (
  personel_ref text PRIMARY KEY REFERENCES kullanici_hesabi (kimlik), bitis_tarihi date NOT NULL, zincir text[] NOT NULL, durum text NOT NULL DEFAULT 'Hazırlanıyor' CHECK (durum IN ('Hazırlanıyor', 'Onayda', 'Sonuçlandı')), oneri text CHECK (oneri IN ('Devam', 'Sonlandırma')), notlar text, hazirlayan_ref text REFERENCES kullanici_hesabi (kimlik), karar_zamani timestamptz, olusturma_zamani timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON akademi_ders, deneme_degerlendirme TO yatonet_uygulama;
GRANT SELECT, INSERT ON akademi_beyan TO yatonet_uygulama;
