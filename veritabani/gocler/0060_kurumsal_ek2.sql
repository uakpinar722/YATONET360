-- YG-1070, D-135: Kurumsal Çerçeve Ek-2 sürümlü kayıttan üretilir; önceki sürüm korunur.
CREATE TABLE kurumsal_ek2 (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), kurum_ref uuid NOT NULL REFERENCES kurumsal_kurum (kimlik), surum integer NOT NULL, satirlar jsonb NOT NULL, dayanak text, gunluk_kanal text, resmi_kanal text, yatlar text[] NOT NULL DEFAULT '{}', islem_turleri text[] NOT NULL DEFAULT '{}', bitis date, bilgi_izni text[] NOT NULL DEFAULT '{}', kaydeden_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), zaman timestamptz NOT NULL DEFAULT now(), UNIQUE (kurum_ref, surum)
);
GRANT SELECT, INSERT ON kurumsal_ek2 TO yatonet_uygulama;
