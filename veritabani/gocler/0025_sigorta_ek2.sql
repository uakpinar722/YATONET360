-- YG-219, YG-1522: Sigorta Çerçeve Sözleşmesi Ek-2 (yetkili kişiler ve kurumsal e-posta adresleri); sürümlü, önceki sürüm korunur.
CREATE TABLE sigorta_ek2_surum (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), sigortaci_adi text NOT NULL, surum integer NOT NULL, durum text NOT NULL DEFAULT 'Yürürlükte' CHECK (durum IN ('Yürürlükte', 'Yerine Geçti')), bildiren_eposta text, bildirim_referansi text, kaydeden_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), zaman timestamptz NOT NULL DEFAULT now(), UNIQUE (sigortaci_adi, surum)
);
CREATE UNIQUE INDEX sigorta_ek2_tek_yururluk ON sigorta_ek2_surum (lower(sigortaci_adi)) WHERE durum = 'Yürürlükte';
CREATE TABLE sigorta_ek2_adres (
  surum_ref uuid NOT NULL REFERENCES sigorta_ek2_surum (kimlik), eposta text NOT NULL, ad_soyad text NOT NULL, gorev text, onay_yetkisi boolean NOT NULL DEFAULT false, temsilci boolean NOT NULL DEFAULT false, tek_islem_limit_eur numeric(14,2) CHECK (tek_islem_limit_eur > 0), gecerlilik_bitis date, PRIMARY KEY (surum_ref, eposta)
);
-- Ek-3: dosyaya özel onay yetkilisi varsa Ek-2 yerine o geçerlidir.
ALTER TABLE dosya_sigorta_kaydi ADD COLUMN IF NOT EXISTS onay_yetkilisi_eposta text;
ALTER TABLE sigorta_onayi ADD COLUMN IF NOT EXISTS gonderen_eposta text;
GRANT SELECT, INSERT, UPDATE ON sigorta_ek2_surum, sigorta_ek2_adres TO yatonet_uygulama;
