-- YG-1042: teknik atama sonrası gerçek izin karşılaştırmasının ayrıntısı (eksik izin, grup uyumu, onaysız ayrıcalıklı izin).
ALTER TABLE erisim_talebi ADD COLUMN izin_karsilastirma jsonb;
