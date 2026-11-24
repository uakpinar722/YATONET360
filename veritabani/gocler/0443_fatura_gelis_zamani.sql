-- YG-884: muhasebeden gelen faturanın geliş zamanı ve 8 saat işleme izi.
ALTER TABLE musteri_faturasi ADD COLUMN muhasebe_gelis_zamani timestamptz, ADD COLUMN gec_islendi boolean NOT NULL DEFAULT false;
