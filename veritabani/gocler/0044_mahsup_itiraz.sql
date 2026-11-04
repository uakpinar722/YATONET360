-- V-186: firma itirazı sonuçlanana kadar mahsup durur; karar Ticari İşler Direktörünündür.
ALTER TABLE hakedis_mahsubu ADD COLUMN itiraz_sonucu text CHECK (itiraz_sonucu IN ('Kabul', 'Ret')), ADD COLUMN itiraz_gerekcesi text, ADD COLUMN itiraz_karar_veren_ref text REFERENCES kullanici_hesabi (kimlik), ADD COLUMN itiraz_karar_zamani timestamptz;
CREATE INDEX hakedis_mahsubu_itiraz ON hakedis_mahsubu (olusturma_zamani) WHERE firma_itiraz IS NOT NULL AND itiraz_sonucu IS NULL;
