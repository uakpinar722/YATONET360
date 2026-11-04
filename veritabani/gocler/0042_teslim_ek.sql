-- YG-414, YG-475, YG-1435 teslim kararı; YG-481 hazır bildirimi; YG-482 sökülen parça; YG-088 yat kabul tutanağı.
ALTER TABLE teslim_kaydi ADD COLUMN karar text CHECK (karar IN ('Kabul', 'Koşullu Kabul')), ADD COLUMN cekince text, ADD COLUMN alici_turu text CHECK (alici_turu IN ('Yat Sahibi', 'Yetkili Temsilci', 'Marina veya Tersane')), ADD COLUMN foto_belge_ref uuid REFERENCES belge (kimlik), ADD COLUMN hatirlatma_zamani timestamptz;
ALTER TABLE dosya ADD COLUMN teslime_hazir_zamani timestamptz, ADD COLUMN teslim_son_tarihi date;
CREATE TABLE sokulen_parca (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), dosya_ref uuid NOT NULL REFERENCES dosya (kimlik), parca_adi text NOT NULL, konum text, secim text CHECK (secim IN ('İade', 'Montaj', 'Süreli Bekletme', 'Hurda-Bertaraf', 'Sigorta Eksperi İncelemesi İçin Bekletme')), secen_ref text REFERENCES kullanici_hesabi (kimlik), secim_zamani timestamptz, son_tarih date NOT NULL, giren_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), olusturma_zamani timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sokulen_parca_dosya ON sokulen_parca (dosya_ref);
CREATE TABLE yat_kabul_tutanagi (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), dosya_ref uuid NOT NULL REFERENCES dosya (kimlik), teslim_alan text NOT NULL CHECK (teslim_alan IN ('LGM', 'Görevli Firma')), envanter text NOT NULL, anahtarlar text NOT NULL, sayaclar text NOT NULL, yakit_seviyesi text NOT NULL, foto_belge_ref uuid NOT NULL REFERENCES belge (kimlik), kaydeden_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), zaman timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON sokulen_parca, yat_kabul_tutanagi TO yatonet_uygulama;
