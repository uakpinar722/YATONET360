-- YG-407: onarım zarfının genişlemesi gizli hasar bulgusuna ve Ek İş iş emrine bağlanır.
ALTER TABLE sapma_kaydi ADD COLUMN IF NOT EXISTS zarf_genisledi boolean NOT NULL DEFAULT false, ADD COLUMN IF NOT EXISTS bulgu_ref uuid REFERENCES bulgu (kimlik), ADD COLUMN IF NOT EXISTS ek_is_emri_ref uuid REFERENCES is_emri (kimlik);
ALTER TABLE sapma_kaydi ADD CONSTRAINT sapma_zarf_bulgu CHECK (NOT zarf_genisledi OR bulgu_ref IS NOT NULL);
