-- YG-862, YG-863, YG-780: dosya iç bütçesi ve risk rezervi; rezerv fiyata eklenmez.
INSERT INTO sistem_parametresi (kod, deger, aciklama) VALUES
  ('risk_rezerv_orani', 0.05, 'Dosya iç bütçesi risk rezervi oranı (0,05 = %5)'),
  ('risk_rezerv_uyari_orani', 0.8, 'Risk rezervi kullanımında erken uyarı oranı (0,8 = %80)'),
  ('butce_asim_uyari_orani', 0.1, 'Bitiş tahmini onaylı bütçeyi bu oranda aşınca erken uyarı (0,1 = %10)')
ON CONFLICT (kod) DO NOTHING;
ALTER TABLE dosya ADD COLUMN IF NOT EXISTS risk_rezerv_orani numeric(6,4) CHECK (risk_rezerv_orani > 0 AND risk_rezerv_orani < 1);
CREATE TABLE risk_rezerv_talebi (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), dosya_ref uuid NOT NULL REFERENCES dosya (kimlik), tur text NOT NULL CHECK (tur IN ('Kullanım', 'Oran Değişikliği')), tutar_eur numeric(14,2) CHECK (tutar_eur > 0), yeni_oran numeric(6,4) CHECK (yeni_oran > 0 AND yeni_oran < 1),
  gerekce text NOT NULL CHECK (length(trim(gerekce)) > 0), durum text NOT NULL DEFAULT 'Onayda' CHECK (durum IN ('Onayda', 'Onaylandı', 'Reddedildi', 'İade Edildi')), talep_eden_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), karar_veren_ref text REFERENCES kullanici_hesabi (kimlik), karar_zamani timestamptz, olusturma_zamani timestamptz NOT NULL DEFAULT now(),
  CHECK ((tur = 'Kullanım' AND tutar_eur IS NOT NULL) OR (tur = 'Oran Değişikliği' AND yeni_oran IS NOT NULL))
);
CREATE INDEX risk_rezerv_dosya ON risk_rezerv_talebi (dosya_ref);
GRANT SELECT, INSERT, UPDATE ON risk_rezerv_talebi TO yatonet_uygulama;
