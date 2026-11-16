-- YG-479: yurt dışında yerleşik veya yabancı malik için Türkiye tebligat adresi.
ALTER TABLE yat_malik ADD COLUMN yurt_disi boolean NOT NULL DEFAULT false, ADD COLUMN tebligat_adresi_tr text;
ALTER TABLE yat_malik ADD CONSTRAINT yat_malik_tebligat_check CHECK (NOT yurt_disi OR length(trim(coalesce(tebligat_adresi_tr, ''))) > 0);
