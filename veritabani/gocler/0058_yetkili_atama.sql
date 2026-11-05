-- YG-1070, ONY-14: bireysel Yetkili Temsilci Atama Beyanı.
ALTER TABLE yat_yetkilisi_kaydi ADD COLUMN yatlar text[] NOT NULL DEFAULT '{}', ADD COLUMN atama_taslak jsonb, ADD COLUMN atama_onay_ref uuid REFERENCES onay_talebi (kimlik);
