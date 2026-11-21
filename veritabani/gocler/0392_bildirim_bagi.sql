-- YG-509: bildirim, olay anahtarındaki kayıttan dosyasına; aynı kayda ait kullanıcının bekleyen görevine bağlanır. Görev ve bildirim ayrı kayıttır.
ALTER TABLE bildirim ADD COLUMN dosya_ref uuid REFERENCES dosya (kimlik);
CREATE FUNCTION bildirim_bagla() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE k text := (regexp_match(coalesce(NEW.olay_anahtari, ''), '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'))[1];
BEGIN
  IF NEW.is_ref IS NULL AND k IS NOT NULL THEN
    NEW.is_ref := (SELECT kimlik FROM is_karti WHERE (kimlik::text = k OR nesne_kimligi = k) AND durum = 'Bekliyor' AND (sahip_kullanici_ref = NEW.kullanici_ref OR kimlik::text = k) ORDER BY olusturma_zamani DESC LIMIT 1);
  END IF;
  IF NEW.dosya_ref IS NULL THEN
    NEW.dosya_ref := coalesce(CASE WHEN k IS NOT NULL THEN gonderim_dosyasi(NEW.olay_anahtari) END,
      (SELECT CASE WHEN c.nesne_turu = 'Dosya' AND c.nesne_kimligi ~ '^[0-9a-f-]{36}$' THEN c.nesne_kimligi::uuid END FROM is_karti c WHERE c.kimlik = NEW.is_ref),
      (SELECT d.kimlik FROM dosya d WHERE d.dosya_no = substring(NEW.baslik FROM 'LGM-[0-9]{4}-[0-9]{2}-[0-9]{4}')));
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER bildirim_bagla BEFORE INSERT ON bildirim FOR EACH ROW EXECUTE FUNCTION bildirim_bagla();
CREATE INDEX bildirim_dosya ON bildirim (dosya_ref) WHERE dosya_ref IS NOT NULL;
