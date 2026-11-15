-- YG-112: tesis türü (marina, liman, barınak, çekek sahası, tersane, bağlama noktası).
ALTER TABLE firma_tesisi ADD COLUMN tesis_turu text CHECK (tesis_turu IN ('Marina', 'Liman', 'Barınak', 'Çekek Sahası', 'Tersane', 'Bağlama Noktası'));
