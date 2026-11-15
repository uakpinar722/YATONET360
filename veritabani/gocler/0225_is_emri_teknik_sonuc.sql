-- YG-320: iş emri beklenen teknik sonuç, yöntem ve LGM sorumlu rolü.
ALTER TABLE is_emri ADD COLUMN teknik_sonuc text, ADD COLUMN yontem text, ADD COLUMN sorumlu_rol text;
