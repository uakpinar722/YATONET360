-- YG-415: teslim bildirimi yapılmadan önce yetkili alıcı ayrı adımda doğrulanır.
CREATE TABLE teslim_alici_dogrulama (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dosya_ref uuid NOT NULL REFERENCES dosya (kimlik), dosya_tarafi_ref uuid NOT NULL REFERENCES dosya_tarafi (kimlik),
  yontem text NOT NULL CHECK (yontem IN ('Kimlik Belgesi', 'Yetki Belgesi', 'Portal Hesabı', 'Kayıtlı Telefonla Geri Arama')),
  aciklama text, dogrulayan_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), zaman timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX teslim_alici_dosya ON teslim_alici_dogrulama (dosya_ref);
GRANT SELECT, INSERT ON teslim_alici_dogrulama TO yatonet_uygulama;
