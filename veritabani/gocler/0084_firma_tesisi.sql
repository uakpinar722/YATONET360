-- TSK-1, YG-010: firmaya bağlı tesis/şube kaydı; tesis kodu sicil numarasına -Tnn eki (LGM-SC-00001-T01). Tek yerleşkeli tesis kuruluşu T01 alır.
CREATE TABLE IF NOT EXISTS firma_tesisi (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), kurulus_ref uuid NOT NULL REFERENCES kurulus (kimlik), sira integer NOT NULL CHECK (sira BETWEEN 1 AND 99), tesis_kodu text NOT NULL UNIQUE,
  ad text NOT NULL CHECK (length(trim(ad)) > 0), adres text, il text, ilce text, aktif boolean NOT NULL DEFAULT true, kaydeden_ref text REFERENCES kullanici_hesabi (kimlik), olusturma_zamani timestamptz NOT NULL DEFAULT now(),
  UNIQUE (kurulus_ref, sira)
);
INSERT INTO firma_tesisi (kurulus_ref, sira, tesis_kodu, ad, il, ilce) SELECT k.kimlik, 1, k.sicil_no || '-T01', k.ticari_unvan, k.il, k.ilce FROM kurulus k WHERE k.kayit_rolu = 'Tesis' ON CONFLICT DO NOTHING;
GRANT SELECT, INSERT, UPDATE ON firma_tesisi TO yatonet_uygulama;
