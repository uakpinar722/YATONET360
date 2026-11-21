-- YG-1382: genel kayıt sürüm sayacı; her güncellemede bir artar. İstemci gördüğü sürümü gönderir, farklıysa çakışma gösterilir.
CREATE OR REPLACE FUNCTION kayit_surumu_artir() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.kayit_surumu := OLD.kayit_surumu + 1;
  RETURN NEW;
END $$;
ALTER TABLE yat ADD COLUMN kayit_surumu bigint NOT NULL DEFAULT 1;
ALTER TABLE acik_konu ADD COLUMN kayit_surumu bigint NOT NULL DEFAULT 1;
CREATE TRIGGER kayit_surumu_artir BEFORE UPDATE ON yat FOR EACH ROW EXECUTE FUNCTION kayit_surumu_artir();
CREATE TRIGGER kayit_surumu_artir BEFORE UPDATE ON acik_konu FOR EACH ROW EXECUTE FUNCTION kayit_surumu_artir();
