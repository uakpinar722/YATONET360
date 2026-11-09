-- YG-113, YG-114, YG-115, YG-333: bağlama noktası kuralları ve kapasitesi; yata uygun tesis önerisi.
ALTER TABLE firma_tesisi
  ADD COLUMN IF NOT EXISTS dis_firma_kurali text CHECK (dis_firma_kurali IN ('Serbest', 'Kayıt Şartlı', 'Ücretli', 'Kısıtlı', 'Yasak')),
  ADD COLUMN IF NOT EXISTS kayit_sarti text, ADD COLUMN IF NOT EXISTS giris_ucreti_eur numeric(12,2) CHECK (giris_ucreti_eur >= 0), ADD COLUMN IF NOT EXISTS servis_kurulus_ref uuid REFERENCES kurulus (kimlik), ADD COLUMN IF NOT EXISTS kural_teyit_tarihi date,
  ADD COLUMN IF NOT EXISTS travel_lift_ton numeric(8,2) CHECK (travel_lift_ton >= 0), ADD COLUMN IF NOT EXISTS vinc_ton numeric(8,2) CHECK (vinc_ton >= 0), ADD COLUMN IF NOT EXISTS azami_boy_m numeric(6,2) CHECK (azami_boy_m > 0), ADD COLUMN IF NOT EXISTS kara_park_kapasitesi integer CHECK (kara_park_kapasitesi >= 0), ADD COLUMN IF NOT EXISTS kapasite_teyit_tarihi date,
  ADD COLUMN IF NOT EXISTS izin_turu text, ADD COLUMN IF NOT EXISTS izin_no text, ADD COLUMN IF NOT EXISTS izin_gecerlilik date, ADD COLUMN IF NOT EXISTS enlem numeric(9,6) CHECK (enlem BETWEEN -90 AND 90), ADD COLUMN IF NOT EXISTS boylam numeric(9,6) CHECK (boylam BETWEEN -180 AND 180);
