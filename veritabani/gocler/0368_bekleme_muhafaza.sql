-- YG-895: onay beklenirken tesisin fiilî bekleme ve muhafaza gideri; teklifin iletildiği andan başlar, serbest süre yok, her gün ayrı kalem.
CREATE TABLE dosya_bekleme_muhafaza (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), dosya_ref uuid NOT NULL REFERENCES dosya (kimlik), teklif_ref uuid NOT NULL UNIQUE REFERENCES fiyat_teklifi (kimlik),
  kurulus_ref uuid NOT NULL REFERENCES kurulus (kimlik), gunluk_eur numeric(12,2) NOT NULL CHECK (gunluk_eur > 0), baslangic timestamptz NOT NULL, bitis timestamptz,
  giren_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), olusturma_zamani timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE bekleme_muhafaza_gunu (kayit_ref uuid NOT NULL REFERENCES dosya_bekleme_muhafaza (kimlik), gun date NOT NULL, tutar_eur numeric(12,2) NOT NULL, PRIMARY KEY (kayit_ref, gun));
GRANT SELECT, INSERT, UPDATE ON dosya_bekleme_muhafaza, bekleme_muhafaza_gunu TO yatonet_uygulama;
