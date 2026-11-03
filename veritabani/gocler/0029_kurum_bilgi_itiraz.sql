-- YG-425: firma bilgi değişikliği LGM teyidiyle işlenir; K-178: ağa kabul kararına 15 gün içinde itiraz.
CREATE TABLE kurum_bilgi_talebi (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), kurulus_ref uuid NOT NULL REFERENCES kurulus (kimlik), alan text NOT NULL CHECK (alan IN ('kurumsal_eposta', 'kurumsal_telefon', 'il', 'ilce')), eski_deger text, yeni_deger text NOT NULL, durum text NOT NULL DEFAULT 'Teyit Bekliyor' CHECK (durum IN ('Teyit Bekliyor', 'İşlendi', 'Reddedildi')), talep_eden_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), olusturma_zamani timestamptz NOT NULL DEFAULT now(), karar_zamani timestamptz
);
CREATE TABLE kurum_kabul_itirazi (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), kurulus_ref uuid NOT NULL REFERENCES kurulus (kimlik), karar_asamasi text NOT NULL, gerekce text NOT NULL, durum text NOT NULL DEFAULT 'İncelemede' CHECK (durum IN ('İncelemede', 'Kabul Edildi', 'Reddedildi')), itiraz_eden_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), olusturma_zamani timestamptz NOT NULL DEFAULT now(), karar_zamani timestamptz
);
ALTER TABLE kurulus ADD COLUMN IF NOT EXISTS kabul_karar_zamani timestamptz;
GRANT SELECT, INSERT, UPDATE ON kurum_bilgi_talebi, kurum_kabul_itirazi TO yatonet_uygulama;
