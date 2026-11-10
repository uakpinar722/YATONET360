-- YG-564, YG-015: gerçek geri yükleme kaydı; duyuru ve yeniden giriş görevleri buna bağlıdır.
CREATE TABLE geri_yukleme_kaydi (kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), yedek_ref uuid NOT NULL REFERENCES yedek_kaydi (kimlik), yedek_zamani timestamptz NOT NULL, aciklama text NOT NULL, kaydeden_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), zaman timestamptz NOT NULL DEFAULT now());
GRANT SELECT, INSERT ON geri_yukleme_kaydi TO yatonet_uygulama;
