-- YG-1601: giden iletinin kopyası dosyaya düşer. Olay anahtarındaki kayıttan (ödeme talebi, tahsilat, taahhüt, hakediş, teknik rapor eklendi) veya konu/metindeki dosya numarasından bağlanır.
CREATE OR REPLACE FUNCTION gonderim_dosyasi(anahtar text) RETURNS uuid LANGUAGE sql STABLE AS $$
  WITH k AS (SELECT (regexp_match(anahtar, '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'))[1]::uuid id)
  SELECT coalesce((SELECT d.kimlik FROM dosya d, k WHERE d.kimlik = k.id), (SELECT d.kimlik FROM dosya d, k WHERE d.talep_ref = k.id),
    (SELECT x.dosya_ref FROM fiyat_teklifi x, k WHERE x.kimlik = k.id), (SELECT x.dosya_ref FROM onay_talebi x, k WHERE x.kimlik = k.id),
    (SELECT x.dosya_ref FROM is_emri x, k WHERE x.kimlik = k.id), (SELECT x.dosya_ref FROM teslim_kaydi x, k WHERE x.kimlik = k.id),
    (SELECT x.dosya_ref FROM musteri_faturasi x, k WHERE x.kimlik = k.id), (SELECT x.dosya_ref FROM odeme_talebi x, k WHERE x.kimlik = k.id),
    (SELECT x.dosya_ref FROM tahsilat x, k WHERE x.kimlik = k.id), (SELECT x.dosya_ref FROM odeme_taahhudu x, k WHERE x.kimlik = k.id),
    (SELECT x.dosya_ref FROM hakedis x, k WHERE x.kimlik = k.id), (SELECT x.dosya_ref FROM teknik_rapor x, k WHERE x.kimlik = k.id))
$$;
ALTER TABLE gonderim ADD COLUMN dosya_ref uuid REFERENCES dosya (kimlik);
CREATE FUNCTION gonderim_bagla() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.dosya_ref IS NULL THEN
    NEW.dosya_ref := coalesce(gonderim_dosyasi(coalesce(NEW.olay_anahtari, '')),
      (SELECT d.kimlik FROM dosya d WHERE d.dosya_no = substring(coalesce(NEW.konu, '') || ' ' || coalesce(NEW.metin, '') FROM 'LGM-[0-9]{4}-[0-9]{2}-[0-9]{4}')));
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER gonderim_bagla BEFORE INSERT ON gonderim FOR EACH ROW EXECUTE FUNCTION gonderim_bagla();
CREATE INDEX gonderim_dosya ON gonderim (dosya_ref) WHERE dosya_ref IS NOT NULL;
