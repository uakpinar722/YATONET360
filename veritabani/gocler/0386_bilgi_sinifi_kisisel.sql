-- YG-1177: kişisel veri taşıyan her kayıt türü varsayılan Gizli bilgi sınıfıyla tutulur; sağlık verisi taşıyan kayıt Kritik başlar;
-- kişisel veri taşıyan hiçbir kayıt Kamuya Açık sınıfında tutulamaz. Kişisel veri sütunu adla tanınır (telefon, e-posta, TCKN, kimlik no,
-- doğum, adres, pasaport, IBAN, sağlık); yeni tablolar bilgi_sinifi_kisisel_eksik() ile denetlenir.
CREATE FUNCTION kisisel_veri_tablolari() RETURNS TABLE (tablo text, saglik boolean) LANGUAGE sql STABLE AS $$
  SELECT c.table_name::text, bool_or(c.column_name ~ 'saglik')
  FROM information_schema.columns c JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE'
  WHERE c.table_schema = 'public' AND c.column_name ~ '(telefon|eposta|e_posta|tckn|kimlik_no|dogum|adres|pasaport|iban|saglik)' AND c.column_name <> 'portal_adresi'
  GROUP BY 1
$$;

DO $$
DECLARE r record; var boolean;
BEGIN
  FOR r IN SELECT * FROM kisisel_veri_tablolari() LOOP
    SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = r.tablo AND column_name = 'bilgi_sinifi') INTO var;
    IF NOT var THEN
      EXECUTE format('ALTER TABLE %I ADD COLUMN bilgi_sinifi text NOT NULL DEFAULT %L', r.tablo, CASE WHEN r.saglik THEN 'Kritik' ELSE 'Gizli' END);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = r.tablo::regclass AND conname = r.tablo || '_bilgi_sinifi_kisisel') THEN
      EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I CHECK (bilgi_sinifi IN (''Kurumsal'', ''Gizli'', ''Kritik''))', r.tablo, r.tablo || '_bilgi_sinifi_kisisel');
    END IF;
  END LOOP;
END $$;

-- Dosya ve yat kişisel veriye bağlıdır (yat sahibi, taraf); sınıfları da Kamuya Açık olamaz.
ALTER TABLE dosya ADD CONSTRAINT dosya_bilgi_sinifi_kisisel CHECK (bilgi_sinifi IN ('Kurumsal', 'Gizli', 'Kritik'));
ALTER TABLE yat ADD COLUMN bilgi_sinifi text NOT NULL DEFAULT 'Gizli' CONSTRAINT yat_bilgi_sinifi_kisisel CHECK (bilgi_sinifi IN ('Kurumsal', 'Gizli', 'Kritik'));

-- Yeni eklenen kişisel veri tablosunda sınıf yoksa veya Kamuya Açık serbestse listeler (test ve veri kalitesi denetimi).
CREATE FUNCTION bilgi_sinifi_kisisel_eksik() RETURNS SETOF text LANGUAGE sql STABLE AS $$
  SELECT k.tablo FROM kisisel_veri_tablolari() k
  WHERE NOT EXISTS (SELECT 1 FROM pg_constraint p WHERE p.conrelid = k.tablo::regclass AND p.contype = 'c' AND pg_get_constraintdef(p.oid) ~ 'bilgi_sinifi' AND pg_get_constraintdef(p.oid) !~ 'Kamuya')
$$;
GRANT EXECUTE ON FUNCTION bilgi_sinifi_kisisel_eksik() TO yatonet_uygulama;
GRANT EXECUTE ON FUNCTION kisisel_veri_tablolari() TO yatonet_uygulama;
