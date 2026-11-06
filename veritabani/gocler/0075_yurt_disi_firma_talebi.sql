-- YG-1660: yurt dışı yerel firma talebini Operasyon Müdürü açar; Firma Yönetimi Müdürü ve Hukuk ve Uyum Direktörü birbirini beklemeden onaylar.
CREATE TABLE IF NOT EXISTS yurt_disi_firma_talebi (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), ulke text NOT NULL, sehir text NOT NULL, ana_brans text NOT NULL, firma_adi text, dosya_ref uuid REFERENCES dosya (kimlik), gerekce text NOT NULL,
  fym_karari text CHECK (fym_karari IN ('Onaylandı', 'Reddedildi')), hud_karari text CHECK (hud_karari IN ('Onaylandı', 'Reddedildi')),
  durum text NOT NULL DEFAULT 'Onayda' CHECK (durum IN ('Onayda', 'Onaylandı', 'Reddedildi')), talep_eden_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), olusturma_zamani timestamptz NOT NULL DEFAULT now()
);
