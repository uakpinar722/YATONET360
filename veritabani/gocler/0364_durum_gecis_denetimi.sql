-- YG-060: durum alanı sözlükte tanımlı bir durumdan izinli geçişleri dışında bir duruma güncellenirse ihlal kaydı düşer (işlem engellenmez).
CREATE TABLE durum_gecis_ihlali (
  kimlik bigserial PRIMARY KEY, kayit_turu text NOT NULL, alan text NOT NULL, kayit_kimligi text, eski text NOT NULL, yeni text, zaman timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON durum_gecis_ihlali TO yatonet_uygulama;
CREATE FUNCTION durum_gecis_denetle() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE e text := to_jsonb(OLD) ->> TG_ARGV[0]; y text := to_jsonb(NEW) ->> TG_ARGV[0]; izin text[];
BEGIN
  IF e IS NOT NULL AND e IS DISTINCT FROM y THEN
    SELECT izinli_gecisler INTO izin FROM durum_sozlugu WHERE kayit_turu = TG_TABLE_NAME AND durum = e;
    IF FOUND AND NOT (coalesce(y, '') = ANY (izin)) THEN
      INSERT INTO durum_gecis_ihlali (kayit_turu, alan, kayit_kimligi, eski, yeni) VALUES (TG_TABLE_NAME, TG_ARGV[0], to_jsonb(NEW) ->> 'kimlik', e, y);
    END IF;
  END IF;
  RETURN NULL;
END $$;
-- Sözlüğü olan her kayıt türünün durum alanına tetikleyici kurar; kurulumda her seferinde yeniden çalışır, yeni kayıt türleri de kapsanır.
CREATE FUNCTION durum_gecis_tetikleyicileri_kur() RETURNS integer LANGUAGE plpgsql AS $$
DECLARE r record; n integer := 0;
BEGIN
  FOR r IN SELECT DISTINCT k.kayit_turu, k.alan FROM durum_kaynagi k WHERE EXISTS (SELECT 1 FROM durum_sozlugu s WHERE s.kayit_turu = k.kayit_turu) LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', 'durum_gecis_' || r.alan, r.kayit_turu);
    EXECUTE format('CREATE TRIGGER %I AFTER UPDATE OF %I ON %I FOR EACH ROW EXECUTE FUNCTION durum_gecis_denetle(%L)', 'durum_gecis_' || r.alan, r.alan, r.kayit_turu, r.alan);
    n := n + 1;
  END LOOP;
  RETURN n;
END $$;
