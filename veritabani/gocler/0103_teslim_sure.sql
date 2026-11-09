-- SRE-1, K-197: tahmini teslim tarihi iş günü takvimiyle hesaplanır; 5 iş günü kala değerlendirme, uzamada en az 3 iş günü kala bildirim.
ALTER TABLE fiyat_teklifi ADD COLUMN IF NOT EXISTS tahmini_teslim_tarihi date;
ALTER TABLE dosya ADD COLUMN IF NOT EXISTS tahmini_teslim_tarihi date, ADD COLUMN IF NOT EXISTS ilk_tahmini_teslim_tarihi date;
CREATE TABLE teslim_sure_degerlendirmesi (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), dosya_ref uuid NOT NULL REFERENCES dosya (kimlik), hedef_tarih date NOT NULL, sonuc text NOT NULL CHECK (sonuc IN ('Uzama Yok', 'Uzama Var')), ek_is_gunu integer CHECK (ek_is_gunu > 0), yeni_tarih date, gerekce text,
  gec_bildirim boolean NOT NULL DEFAULT false, karar_veren_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), olusturma_zamani timestamptz NOT NULL DEFAULT now(), UNIQUE (dosya_ref, hedef_tarih),
  CHECK (sonuc <> 'Uzama Var' OR (ek_is_gunu IS NOT NULL AND yeni_tarih IS NOT NULL AND length(trim(gerekce)) > 0))
);
GRANT SELECT, INSERT, UPDATE ON teslim_sure_degerlendirmesi TO yatonet_uygulama;
