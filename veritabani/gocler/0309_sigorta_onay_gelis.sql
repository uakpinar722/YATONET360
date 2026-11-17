-- YG-455: yazılı onayın LGM'ye geliş zamanı ve 8 saati aşan kayıtta gecikme gerekçesi.
ALTER TABLE sigorta_onayi ADD COLUMN gelis_zamani timestamptz, ADD COLUMN kayit_gecikme_gerekcesi text;
