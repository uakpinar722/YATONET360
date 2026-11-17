-- YG-174: Ticari Sorumlunun gerekçeli indirim talebi (onaylanınca uygulanır).
ALTER TABLE fiyat_teklifi ADD COLUMN indirim_talep_orani integer CHECK (indirim_talep_orani BETWEEN 1 AND 10), ADD COLUMN indirim_talep_gerekcesi text, ADD COLUMN indirim_talep_eden_ref text REFERENCES kullanici_hesabi (kimlik);
