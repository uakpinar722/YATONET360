-- YG-1616: İnsan Kaynakları Müdürünün yıllık eğitim planı ve personel yan hak kaydı (tutar tutulmaz; ücret bandı yoktur).
CREATE TABLE egitim_plani (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), yil integer NOT NULL CHECK (yil BETWEEN 2026 AND 2100), ders_ref uuid REFERENCES akademi_ders (kimlik), egitim_adi text NOT NULL CHECK (length(trim(egitim_adi)) > 0),
  hedef_roller text[] NOT NULL DEFAULT '{}', planlanan_ay integer NOT NULL CHECK (planlanan_ay BETWEEN 1 AND 12), aciklama text, kaydeden_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), zaman timestamptz NOT NULL DEFAULT now(), UNIQUE (yil, egitim_adi)
);
CREATE TABLE personel_yan_hak (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), personel_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), tur text NOT NULL CHECK (length(trim(tur)) > 0), aciklama text,
  baslangic date NOT NULL, bitis date, kaydeden_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), zaman timestamptz NOT NULL DEFAULT now(), CHECK (bitis IS NULL OR bitis >= baslangic)
);
CREATE INDEX personel_yan_hak_personel ON personel_yan_hak (personel_ref);
GRANT SELECT, INSERT, UPDATE ON egitim_plani, personel_yan_hak TO yatonet_uygulama;
