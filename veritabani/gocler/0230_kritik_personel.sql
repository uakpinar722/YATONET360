-- YG-340: kritik personel ve eşdeğer yeterlilikle değişim.
ALTER TABLE firma_personeli ADD COLUMN kritik boolean NOT NULL DEFAULT false, ADD COLUMN yerine_gectigi_ref uuid REFERENCES firma_personeli (kimlik), ADD COLUMN yeterlilik_belge_ref uuid REFERENCES belge (kimlik), ADD COLUMN esdegerlik_sonucu text;
