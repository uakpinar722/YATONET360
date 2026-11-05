-- İP-11: görev ayrılığı, firma kimliği açıklama, Kritik erişim grubu, değişiklik bileti, risk kabulü, hasar paylaşımı, Yat Yetkilisi onayı.
ALTER TABLE kontrol_noktasi ADD COLUMN dogrulayanlar text[] NOT NULL DEFAULT '{}';
CREATE TABLE firma_kimlik_aciklama (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), dosya_ref uuid NOT NULL REFERENCES dosya (kimlik), kurulus_ref uuid NOT NULL REFERENCES kurulus (kimlik), talep_eden_makam text NOT NULL CHECK (talep_eden_makam IN ('Mahkeme', 'Yetkili Resmî Makam')), dayanak text NOT NULL, dayanak_belge_ref uuid NOT NULL REFERENCES belge (kimlik), aciklama_duzeyi text NOT NULL, durum text NOT NULL DEFAULT 'Onayda' CHECK (durum IN ('Onayda', 'Onaylandı', 'Reddedildi')), hazirlayan_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), onaylayan_ref text REFERENCES kullanici_hesabi (kimlik), zaman timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE belge_erisim_grubu (belge_ref uuid NOT NULL REFERENCES belge (kimlik), kullanici_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), ekleyen_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), zaman timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (belge_ref, kullanici_ref));
CREATE TABLE degisiklik_bileti (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), bilet_no text NOT NULL UNIQUE, konu text NOT NULL, gerekce text NOT NULL, kisisel_veri boolean NOT NULL DEFAULT false, veri_sahibi_rol text, oncesi_kanit_ref uuid REFERENCES belge (kimlik), sonrasi_kanit_ref uuid REFERENCES belge (kimlik), durum text NOT NULL DEFAULT 'Onayda' CHECK (durum IN ('Onayda', 'Onaylandı', 'Reddedildi', 'Kapalı')), hazirlayan_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), zaman timestamptz NOT NULL DEFAULT now(), kapanis_zamani timestamptz
);
CREATE TABLE risk_kabulu (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), kullanici_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), rol_ref text NOT NULL REFERENCES rol (kimlik), sahip_rol text NOT NULL, gerekce text NOT NULL, telafi_kontrolu text NOT NULL, yeniden_inceleme date NOT NULL, kaydeden_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), zaman timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE hasar_paylasim_talebi (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), dosya_ref uuid NOT NULL REFERENCES dosya (kimlik), alici text NOT NULL, kapsam text NOT NULL, cift_onay boolean NOT NULL DEFAULT false, durum text NOT NULL DEFAULT 'Onayda' CHECK (durum IN ('Onayda', 'Onaylandı', 'Reddedildi')), talep_eden_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), zaman timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE onay_talebi ADD COLUMN adina_onay_sahibi text;
ALTER TABLE mobil_cihaz ADD COLUMN son_dogrulama timestamptz NOT NULL DEFAULT now();
CREATE UNIQUE INDEX kartela_tek_yururluk ON kartela_surumu ((true)) WHERE durum = 'Yürürlükte';
GRANT SELECT, INSERT, UPDATE ON firma_kimlik_aciklama, belge_erisim_grubu, degisiklik_bileti, risk_kabulu, hasar_paylasim_talebi TO yatonet_uygulama;
GRANT DELETE ON belge_erisim_grubu TO yatonet_uygulama;
