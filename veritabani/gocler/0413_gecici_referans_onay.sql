-- YG-177, YG-1313: platform dışı işlemin türü (onay ayrı izlenir) ve geri giriş gecikmesinin gerekçesi.
ALTER TABLE gecici_referans ADD COLUMN islem_turu text NOT NULL DEFAULT 'Diğer' CHECK (islem_turu IN ('Onay', 'Diğer')), ADD COLUMN gecikme_gerekcesi text;
