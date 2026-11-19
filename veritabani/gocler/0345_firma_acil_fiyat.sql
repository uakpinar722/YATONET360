-- YG-1473: Çözüm Ortağının acil birim fiyatları (ağa kabulde); müşteriye ve kartelaya gösterilmez.
CREATE TABLE firma_acil_fiyat (
  kurulus_ref uuid PRIMARY KEY REFERENCES kurulus (kimlik), cikis_eur numeric(12,2) NOT NULL CHECK (cikis_eur >= 0), ekip_saat_eur numeric(12,2) NOT NULL CHECK (ekip_saat_eur > 0), ekipman_eur numeric(12,2) NOT NULL DEFAULT 0 CHECK (ekipman_eur >= 0),
  bant_disi_gerekce text, giren_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), zaman timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON firma_acil_fiyat TO yatonet_uygulama;
