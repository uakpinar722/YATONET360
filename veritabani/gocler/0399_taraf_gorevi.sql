-- YG-1071: bir dosya tarafının dosyadaki işlevsel görevleri; bir kişi birden çok görevi dayanak ve sınırıyla taşıyabilir. Talebi ileten
-- dosya açılışındaki talep sahibinden kendiliğinden yazılır.
CREATE TABLE dosya_taraf_gorevi (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), dosya_tarafi_ref uuid NOT NULL REFERENCES dosya_tarafi (kimlik),
  gorev text NOT NULL CHECK (gorev IN ('Talebi İleten', 'Teknik Muhatap', 'Sözleşme İmzalayan', 'Kapsam Onaylayan', 'Mali Taahhüt Veren', 'Ödeme Yapan', 'Yatı Teslim Alan')),
  dayanak text NOT NULL CHECK (length(btrim(dayanak)) > 0), sinir text, aktif boolean NOT NULL DEFAULT true,
  kaydeden_ref text REFERENCES kullanici_hesabi (kimlik), zaman timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX dosya_taraf_gorevi_tekil ON dosya_taraf_gorevi (dosya_tarafi_ref, gorev) WHERE aktif;
GRANT SELECT, INSERT, UPDATE ON dosya_taraf_gorevi TO yatonet_uygulama;
INSERT INTO dosya_taraf_gorevi (dosya_tarafi_ref, gorev, dayanak) SELECT kimlik, 'Talebi İleten', 'Hasar ihbarı kaydı' FROM dosya_tarafi WHERE talep_sahibi_mi AND aktif;
CREATE FUNCTION talep_sahibi_gorevi() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.talep_sahibi_mi THEN INSERT INTO dosya_taraf_gorevi (dosya_tarafi_ref, gorev, dayanak, kaydeden_ref) VALUES (NEW.kimlik, 'Talebi İleten', 'Hasar ihbarı kaydı', NEW.olusturan_ref) ON CONFLICT DO NOTHING; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER talep_sahibi_gorevi AFTER INSERT ON dosya_tarafi FOR EACH ROW EXECUTE FUNCTION talep_sahibi_gorevi();
