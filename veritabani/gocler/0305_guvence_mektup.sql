-- YG-838: banka mektubu verilen iş emrinde güvence kesintisi yapılmaz; kesinti 12 ay sonra iade görevine düşer.
ALTER TABLE is_emri ADD COLUMN banka_mektubu_ref uuid REFERENCES belge (kimlik), ADD COLUMN guvence_iade_zamani timestamptz;
