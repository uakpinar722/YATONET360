-- YG-1225: işlem güvenliği logları LOG-2 süresiyle silinir; silinen satırın içeriksiz bütünlük özeti kalır (zincir doğrulanabilir).
CREATE TABLE denetim_izi_ayiklama (
  kimlik bigint PRIMARY KEY, olay_zamani timestamptz NOT NULL, eylem text NOT NULL, onceki_butunluk text, butunluk_degeri text NOT NULL, ayiklama_zamani timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON denetim_izi_ayiklama TO yatonet_uygulama;

CREATE OR REPLACE FUNCTION denetim_izi_degismez() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('yatonet.iz_ayiklama', true) = 'evet'
     AND OLD.eylem IN ('Giriş Denemesi', 'Giriş', 'Çıkış', 'Oturum Kapandı', 'Doğrulama Kodu Denemesi', 'Adres Bazlı Deneme Sınırı', 'Parola Değişikliği', 'Parola Yenileme Talebi', 'Parola Yenilendi')
     AND EXISTS (SELECT 1 FROM denetim_izi_ayiklama a WHERE a.kimlik = OLD.kimlik) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'İşlem izi değiştirilemez ve silinemez';
END $$;

CREATE FUNCTION guvenlik_izi_ayikla(sinir timestamptz) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n integer;
BEGIN
  IF sinir > now() - interval '24 months' THEN RAISE EXCEPTION 'Güvenlik logları 24 aydan önce silinmez'; END IF;
  INSERT INTO denetim_izi_ayiklama (kimlik, olay_zamani, eylem, onceki_butunluk, butunluk_degeri)
    SELECT kimlik, olay_zamani, eylem, onceki_butunluk, butunluk_degeri FROM denetim_izi
    WHERE olay_zamani < sinir AND eylem IN ('Giriş Denemesi', 'Giriş', 'Çıkış', 'Oturum Kapandı', 'Doğrulama Kodu Denemesi', 'Adres Bazlı Deneme Sınırı', 'Parola Değişikliği', 'Parola Yenileme Talebi', 'Parola Yenilendi')
    ON CONFLICT DO NOTHING;
  PERFORM set_config('yatonet.iz_ayiklama', 'evet', true);
  DELETE FROM denetim_izi z USING denetim_izi_ayiklama a WHERE a.kimlik = z.kimlik;
  GET DIAGNOSTICS n = ROW_COUNT;
  PERFORM set_config('yatonet.iz_ayiklama', '', true);
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION guvenlik_izi_ayikla(timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION guvenlik_izi_ayikla(timestamptz) TO yatonet_uygulama;
