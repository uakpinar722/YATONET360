-- YG-802 (KS-6): kabul anındaki beyan edilen acil yanıt süresi ve sahaya varış zamanı.
ALTER TABLE is_emri ADD COLUMN acil_beyan_dk integer, ADD COLUMN acil_varis_zamani timestamptz;
