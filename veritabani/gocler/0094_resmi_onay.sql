-- YG-1441: hizmet kapsamı işleminde "resmî/klas onayı gerekebilir" etiketi; teklif kaleminde TU kararı; firma raporunda evet/hayır.
ALTER TABLE kartela_kalemi ADD COLUMN IF NOT EXISTS resmi_onay_gerekebilir boolean NOT NULL DEFAULT false;
ALTER TABLE fiyat_teklifi_kalemi ADD COLUMN IF NOT EXISTS resmi_onay_karari text CHECK (resmi_onay_karari IN ('Gerekli', 'Gerekmez')),
  ADD COLUMN IF NOT EXISTS resmi_onay_karar_veren_ref text REFERENCES kullanici_hesabi (kimlik), ADD COLUMN IF NOT EXISTS resmi_onay_karar_zamani timestamptz;
ALTER TABLE firma_teknik_raporu ADD COLUMN IF NOT EXISTS resmi_onay_gerekir boolean;
