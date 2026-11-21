-- YG-518: taraf ana kaydı ve kullanıcı hesabının telefon ve e-posta bilgisi de kaynak ve geçerlilikle tutulur; değişen değer silinmez,
-- geçmiş kanıt olarak kalır, güncel değer bildirim hedefidir (dosya tarafındaki iletişim bilgisi 0141 iletisim_bilgisi ile tutulur).
CREATE TABLE ana_iletisim_gecmisi (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kayit_turu text NOT NULL CHECK (kayit_turu IN ('Taraf', 'Kullanıcı')), kayit_ref text NOT NULL,
  tur text NOT NULL CHECK (tur IN ('Telefon', 'E-posta')), deger text NOT NULL,
  kaynak text NOT NULL DEFAULT 'Sistem Kaydı', gecerli boolean NOT NULL DEFAULT true, bildirim_hedefi boolean NOT NULL DEFAULT true, gecersiz_zamani timestamptz,
  bilgi_sinifi text NOT NULL DEFAULT 'Gizli' CHECK (bilgi_sinifi IN ('Kurumsal', 'Gizli', 'Kritik')),
  olusturma_zamani timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ana_iletisim_gecmisi_kayit ON ana_iletisim_gecmisi (kayit_turu, kayit_ref);
CREATE UNIQUE INDEX ana_iletisim_gecmisi_hedef ON ana_iletisim_gecmisi (kayit_turu, kayit_ref, tur) WHERE bildirim_hedefi;

-- Bağımsız değişkenler: kayıt türü, telefon sütunu, e-posta sütunu.
CREATE FUNCTION ana_iletisim_izle() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE t text; v text; e text; y jsonb := to_jsonb(NEW); o jsonb := CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) END;
BEGIN
  FOREACH t IN ARRAY ARRAY['Telefon', 'E-posta'] LOOP
    v := y ->> CASE t WHEN 'Telefon' THEN TG_ARGV[1] ELSE TG_ARGV[2] END;
    e := o ->> CASE t WHEN 'Telefon' THEN TG_ARGV[1] ELSE TG_ARGV[2] END;
    IF v IS DISTINCT FROM e THEN
      UPDATE ana_iletisim_gecmisi SET bildirim_hedefi = false, gecerli = false, gecersiz_zamani = now() WHERE kayit_turu = TG_ARGV[0] AND kayit_ref = NEW.kimlik::text AND tur = t AND bildirim_hedefi;
      IF v IS NOT NULL AND btrim(v) <> '' THEN INSERT INTO ana_iletisim_gecmisi (kayit_turu, kayit_ref, tur, deger) VALUES (TG_ARGV[0], NEW.kimlik::text, t, v); END IF;
    END IF;
  END LOOP;
  RETURN NEW;
END $$;
CREATE TRIGGER ana_iletisim_izle AFTER INSERT OR UPDATE OF telefon, eposta ON taraf FOR EACH ROW EXECUTE FUNCTION ana_iletisim_izle('Taraf', 'telefon', 'eposta');
CREATE TRIGGER ana_iletisim_izle AFTER INSERT OR UPDATE OF cep_telefonu, e_posta ON kullanici_hesabi FOR EACH ROW EXECUTE FUNCTION ana_iletisim_izle('Kullanıcı', 'cep_telefonu', 'e_posta');

INSERT INTO ana_iletisim_gecmisi (kayit_turu, kayit_ref, tur, deger) SELECT 'Taraf', kimlik::text, 'Telefon', telefon FROM taraf WHERE btrim(coalesce(telefon, '')) <> '';
INSERT INTO ana_iletisim_gecmisi (kayit_turu, kayit_ref, tur, deger) SELECT 'Taraf', kimlik::text, 'E-posta', eposta FROM taraf WHERE btrim(coalesce(eposta, '')) <> '';
INSERT INTO ana_iletisim_gecmisi (kayit_turu, kayit_ref, tur, deger) SELECT 'Kullanıcı', kimlik, 'Telefon', cep_telefonu FROM kullanici_hesabi WHERE btrim(coalesce(cep_telefonu, '')) <> '';
INSERT INTO ana_iletisim_gecmisi (kayit_turu, kayit_ref, tur, deger) SELECT 'Kullanıcı', kimlik, 'E-posta', e_posta FROM kullanici_hesabi WHERE btrim(coalesce(e_posta, '')) <> '';
GRANT SELECT ON ana_iletisim_gecmisi TO yatonet_uygulama;
