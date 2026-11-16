-- YG-309: iş emrinin yürütüleceği firma tesisi; kapasite tesis bazında sayılır.
ALTER TABLE is_emri ADD COLUMN tesis_ref uuid REFERENCES firma_tesisi (kimlik);
