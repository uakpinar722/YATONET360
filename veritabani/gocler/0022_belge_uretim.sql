-- YG-665, YG-466, YG-558: resmî PDF üretim kuyruğu ve e-posta ekleri.
CREATE TABLE belge_uretim (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), tur text NOT NULL CHECK (tur IN ('Fiyat Teklifi', 'Teknik Rapor', 'Onay Belgesi', 'Proforma', 'Ödeme Talebi')), nesne text NOT NULL, dosya_ref uuid NOT NULL REFERENCES dosya (kimlik), gonder jsonb, durum text NOT NULL DEFAULT 'Bekliyor' CHECK (durum IN ('Bekliyor', 'Üretildi', 'Başarısız')), deneme integer NOT NULL DEFAULT 0, son_hata text, belge_ref uuid REFERENCES belge (kimlik), surum_ref uuid, olusturma_zamani timestamptz NOT NULL DEFAULT now(), UNIQUE (tur, nesne)
);
CREATE INDEX belge_uretim_bekleyen ON belge_uretim (durum) WHERE durum = 'Bekliyor';
ALTER TABLE gonderim ADD COLUMN IF NOT EXISTS ek_surumler uuid[] NOT NULL DEFAULT '{}';
GRANT SELECT, INSERT, UPDATE ON belge_uretim TO yatonet_uygulama;
