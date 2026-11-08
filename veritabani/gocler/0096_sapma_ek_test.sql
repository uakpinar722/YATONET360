-- YG-394: özel proses sapmasında ek test gerekiyorsa test sonucu girilmeden İşi Durdur dışında karar verilmez.
ALTER TABLE sapma_kaydi ADD COLUMN IF NOT EXISTS ek_test_ref uuid REFERENCES test_kaydi (kimlik);
