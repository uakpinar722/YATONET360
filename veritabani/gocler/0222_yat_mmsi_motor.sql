-- YG-091: MMSI ve motor bilgisi.
ALTER TABLE yat ADD COLUMN mmsi text CHECK (mmsi ~ '^[0-9]{9}$'), ADD COLUMN motor_adedi integer CHECK (motor_adedi BETWEEN 0 AND 10), ADD COLUMN motor_marka_model text, ADD COLUMN motor_gucu_hp numeric(8,1) CHECK (motor_gucu_hp > 0);
