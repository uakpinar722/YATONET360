-- YG-227: teklif statü ve karar geçişleri kendiliğinden kaydedilir (Teklif Statü Geçişi ekranı).
CREATE TABLE teklif_statu_gecmisi (
  kimlik bigserial PRIMARY KEY, teklif_ref uuid NOT NULL REFERENCES fiyat_teklifi (kimlik), eski_statu text, yeni_statu text NOT NULL, karar text, zaman timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX teklif_statu_gecmisi_zaman ON teklif_statu_gecmisi (zaman);
CREATE OR REPLACE FUNCTION teklif_statu_yaz() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.statu IS DISTINCT FROM OLD.statu OR NEW.karar IS DISTINCT FROM OLD.karar THEN
    INSERT INTO teklif_statu_gecmisi (teklif_ref, eski_statu, yeni_statu, karar) VALUES (NEW.kimlik, CASE WHEN TG_OP = 'UPDATE' THEN OLD.statu END, NEW.statu, NEW.karar);
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER teklif_statu_yaz AFTER INSERT OR UPDATE OF statu, karar ON fiyat_teklifi FOR EACH ROW EXECUTE FUNCTION teklif_statu_yaz();
INSERT INTO teklif_statu_gecmisi (teklif_ref, yeni_statu, karar, zaman) SELECT kimlik, statu, karar, coalesce(karar_zamani, gonderim_zamani, olusturma_zamani) FROM fiyat_teklifi;
GRANT SELECT, INSERT ON teklif_statu_gecmisi TO yatonet_uygulama;
GRANT USAGE ON SEQUENCE teklif_statu_gecmisi_kimlik_seq TO yatonet_uygulama;
