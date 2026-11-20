-- YG-1645 (A34): kişisel veri içeren süreli erişim talebinde veri sahibi birim onayı.
ALTER TABLE erisim_talebi ADD COLUMN kisisel_veri boolean NOT NULL DEFAULT false, ADD COLUMN veri_sahibi_rol_ref text REFERENCES rol (kimlik);
