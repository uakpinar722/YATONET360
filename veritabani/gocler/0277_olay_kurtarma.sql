-- YG-1282: BT kesintisinde sıralı kurtarma adımları (kimlik → ağ → veri → uygulama → belge → rapor → entegrasyon).
CREATE TABLE olay_kurtarma_adimi (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), olay_ref uuid NOT NULL REFERENCES olay_kaydi (kimlik), sira integer NOT NULL, hizmet text NOT NULL,
  sonuc text NOT NULL CHECK (sonuc IN ('Açıldı', 'Başarısız – Geri Dönüldü')), aciklama text, yapan_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), zaman timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX olay_kurtarma_olay ON olay_kurtarma_adimi (olay_ref, sira);
GRANT SELECT, INSERT ON olay_kurtarma_adimi TO yatonet_uygulama;
