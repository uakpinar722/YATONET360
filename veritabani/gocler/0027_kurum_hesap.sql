-- YG-1004, YG-425: kurum kullanıcısı kurum talebi ve LGM teyidiyle açılır, kurum bildirdiğinde kapanır.
CREATE TABLE kurum_kullanici_talebi (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), kurulus_ref uuid NOT NULL REFERENCES kurulus (kimlik), ad_soyad text NOT NULL, eposta text NOT NULL, telefon text, durum text NOT NULL DEFAULT 'Teyit Bekliyor' CHECK (durum IN ('Teyit Bekliyor', 'Açıldı', 'Reddedildi')), talep_eden_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), kullanici_ref text REFERENCES kullanici_hesabi (kimlik), olusturma_zamani timestamptz NOT NULL DEFAULT now(), karar_zamani timestamptz
);
CREATE UNIQUE INDEX kurum_talep_tek ON kurum_kullanici_talebi (lower(eposta)) WHERE durum = 'Teyit Bekliyor';
-- YG-298, YG-845: tedarikçi ödeme durumu; vade kabul ve faturadan 60 gün.
ALTER TABLE tedarikci_faturasi ADD COLUMN IF NOT EXISTS odeme_zamani timestamptz, ADD COLUMN IF NOT EXISTS odeyen_ref text REFERENCES kullanici_hesabi (kimlik);
GRANT SELECT, INSERT, UPDATE ON kurum_kullanici_talebi TO yatonet_uygulama;
GRANT UPDATE ON tedarikci_faturasi TO yatonet_uygulama;
