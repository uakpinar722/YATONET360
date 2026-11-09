-- YG-1454, K-192, YNT-1: Onarım Yöntem Raporu (FR-ONR-001); Teknik Uzman hazırlar, Teknik Müdür onaylar.
CREATE TABLE yontem_raporu (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), rapor_no text NOT NULL UNIQUE, dosya_ref uuid NOT NULL REFERENCES dosya (kimlik), kapsam text NOT NULL CHECK (length(trim(kapsam)) > 0), malzeme_tablosu text NOT NULL CHECK (length(trim(malzeme_tablosu)) > 0), uygulama_sirasi text NOT NULL CHECK (length(trim(uygulama_sirasi)) > 0),
  eszamanli_yapilamaz text, cizim_belge_ref uuid REFERENCES belge (kimlik), muadil_parcalar text[] NOT NULL DEFAULT '{}', sinirlar jsonb NOT NULL DEFAULT '[]',
  durum text NOT NULL DEFAULT 'Onayda' CHECK (durum IN ('Onayda', 'Onaylı', 'Reddedildi', 'İade Edildi', 'Yerine Geçti')), hazirlayan_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), onaylayan_ref text REFERENCES kullanici_hesabi (kimlik), onay_zamani timestamptz, olusturma_zamani timestamptz NOT NULL DEFAULT now(),
  CHECK (durum NOT IN ('Onaylı', 'Yerine Geçti') OR (onaylayan_ref IS NOT NULL AND onay_zamani IS NOT NULL))
);
CREATE INDEX yontem_raporu_dosya ON yontem_raporu (dosya_ref);
GRANT SELECT, INSERT, UPDATE ON yontem_raporu TO yatonet_uygulama;
