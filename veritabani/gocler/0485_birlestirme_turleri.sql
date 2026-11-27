-- YG-1244 (V-1112): mükerrer ekipman, sözleşme ve belge kayıtları da veri sahibinin kararıyla birleştirilir ve geri alınabilir.
ALTER TABLE firma_ekipmani ADD COLUMN birlestirilen_ana_ref uuid;
ALTER TABLE sozlesme_kaydi ADD COLUMN birlestirilen_ana_ref uuid;
ALTER TABLE belge ADD COLUMN birlestirilen_ana_ref uuid;
ALTER TABLE kayit_birlestirme DROP CONSTRAINT kayit_birlestirme_tur_check;
ALTER TABLE kayit_birlestirme ADD CONSTRAINT kayit_birlestirme_tur_check CHECK (tur IN ('yat', 'taraf', 'firma_ekipmani', 'sozlesme_kaydi', 'belge'));
CREATE OR REPLACE FUNCTION kayit_birlestir(p_tur text, p_ana uuid, p_eski uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record; ids text[]; sonuc jsonb := '[]';
BEGIN
  IF p_tur NOT IN ('yat', 'taraf', 'firma_ekipmani', 'sozlesme_kaydi', 'belge') THEN RAISE EXCEPTION 'Geçersiz kayıt türü'; END IF;
  FOR r IN SELECT c.conrelid::regclass::text tablo, a.attname kolon, EXISTS (SELECT 1 FROM pg_attribute k WHERE k.attrelid = c.conrelid AND k.attname = 'kimlik' AND NOT k.attisdropped) kimlikli
    FROM pg_constraint c JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
    WHERE c.contype = 'f' AND c.confrelid = p_tur::regclass AND array_length(c.conkey, 1) = 1 LOOP
    IF NOT r.kimlikli THEN
      EXECUTE format('SELECT CASE WHEN EXISTS (SELECT 1 FROM %s WHERE %I = $1) THEN ARRAY[''x''] ELSE ''{}''::text[] END', r.tablo, r.kolon) INTO ids USING p_eski;
      IF cardinality(ids) > 0 THEN RAISE EXCEPTION 'Taşınamayan ilişki: %', r.tablo; END IF;
      CONTINUE;
    END IF;
    EXECUTE format('SELECT coalesce(array_agg(kimlik::text), ''{}'') FROM %s WHERE %I = $1', r.tablo, r.kolon) INTO ids USING p_eski;
    IF cardinality(ids) > 0 THEN
      EXECUTE format('UPDATE %s SET %I = $1 WHERE kimlik::text = ANY($2)', r.tablo, r.kolon) USING p_ana, ids;
      sonuc := sonuc || jsonb_build_array(jsonb_build_object('tablo', r.tablo, 'kolon', r.kolon, 'kimlikler', to_jsonb(ids)));
    END IF;
  END LOOP;
  EXECUTE format('UPDATE %I SET birlestirilen_ana_ref = $1 WHERE kimlik = $2', p_tur) USING p_ana, p_eski;
  RETURN sonuc;
END $$;
