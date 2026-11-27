-- YG-310 (V-1131): iş emrinin önce bitmesi gereken iş emrine bağı; kapasite değerlendirmesinde bağımlılık ve saha penceresi.
ALTER TABLE is_emri ADD COLUMN onceki_is_emri_ref uuid REFERENCES is_emri (kimlik);
