-- YG-347: firma konumu bağlama noktasına bağı.
ALTER TABLE kurulus ADD COLUMN baglama_noktasi_ref uuid REFERENCES baglama_noktasi (kimlik);
