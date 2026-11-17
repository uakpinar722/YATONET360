-- YG-236, YG-177: teklif gönderildiği gündeki ve sigorta onayı tarihindeki TCMB EUR satış kuru (yayın yoksa önceki son yayın) kayda yazılır; kur yoksa boş kalır.
ALTER TABLE fiyat_teklifi ADD COLUMN teklif_kuru numeric(12,4), ADD COLUMN teklif_kur_tarihi date;
ALTER TABLE sigorta_onayi ADD COLUMN onay_kuru numeric(12,4), ADD COLUMN onay_kur_tarihi date;
CREATE FUNCTION teklif_kuru_yaz() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.statu = 'Gönderildi' AND OLD.statu IS DISTINCT FROM 'Gönderildi' THEN
    SELECT satis, tarih INTO NEW.teklif_kuru, NEW.teklif_kur_tarihi FROM doviz_kuru WHERE para_birimi = 'EUR' AND tarih <= (now() AT TIME ZONE 'Europe/Istanbul')::date ORDER BY tarih DESC LIMIT 1;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER teklif_kuru BEFORE UPDATE OF statu ON fiyat_teklifi FOR EACH ROW EXECUTE FUNCTION teklif_kuru_yaz();
CREATE FUNCTION onay_kuru_yaz() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  SELECT satis, tarih INTO NEW.onay_kuru, NEW.onay_kur_tarihi FROM doviz_kuru WHERE para_birimi = 'EUR' AND tarih <= (coalesce(NEW.onay_tarihi, now()) AT TIME ZONE 'Europe/Istanbul')::date ORDER BY tarih DESC LIMIT 1;
  RETURN NEW;
END $$;
CREATE TRIGGER onay_kuru BEFORE INSERT ON sigorta_onayi FOR EACH ROW EXECUTE FUNCTION onay_kuru_yaz();
