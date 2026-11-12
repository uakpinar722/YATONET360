-- Ek II §10.7: kullanılmayan zorunlu form için gerekçeli istisna ve eşdeğer kontrol.
CREATE TABLE zorunlu_form_istisnasi (
  dosya_ref uuid NOT NULL REFERENCES dosya (kimlik), form_kodu text NOT NULL REFERENCES form_katalogu (kod), gerekce text NOT NULL, esdeger_kontrol text NOT NULL,
  kaydeden_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), zaman timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (dosya_ref, form_kodu)
);
GRANT SELECT, INSERT ON zorunlu_form_istisnasi TO yatonet_uygulama;
