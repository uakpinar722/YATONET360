-- YG-1308: entegrasyon kaydında kaynak/hedef sistem, sürüm, etkilenen kayıtlar, dosya ve dondurma; yeniden deneme ve manuel doğrulama kaydı.
ALTER TABLE entegrasyon_kaydi ADD COLUMN kaynak_sistem text, ADD COLUMN hedef_sistem text, ADD COLUMN surum text, ADD COLUMN etkilenen_kayitlar text[] NOT NULL DEFAULT '{}',
  ADD COLUMN dosya_ref uuid REFERENCES dosya (kimlik), ADD COLUMN donduruldu boolean NOT NULL DEFAULT false;
CREATE TABLE entegrasyon_yeniden_isleme (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), kayit_ref uuid NOT NULL REFERENCES entegrasyon_kaydi (kimlik),
  tur text NOT NULL CHECK (tur IN ('Yeniden Deneme', 'Manuel Doğrulama')), sonuc text NOT NULL, gerekce text NOT NULL CHECK (length(btrim(gerekce)) > 0),
  yapan_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), zaman timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON entegrasyon_yeniden_isleme TO yatonet_uygulama;
