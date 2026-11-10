-- YG-518: iletişim bilgisi kaynak, doğrulama zamanı, kullanım amacı ve geçerlilikle tutulur; eski bilgi kanıt olarak kalır, güncel bildirim hedefi ayrı seçilir.
CREATE TABLE iletisim_bilgisi (kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), taraf_ref uuid NOT NULL REFERENCES dosya_tarafi (kimlik), tur text NOT NULL CHECK (tur IN ('Telefon', 'E-posta')), deger text NOT NULL, kaynak text NOT NULL DEFAULT 'Sistem Kaydı', amac text NOT NULL DEFAULT 'Dosya İletişimi', dogrulama_zamani timestamptz, dogrulayan_ref text REFERENCES kullanici_hesabi (kimlik), gecerli boolean NOT NULL DEFAULT true, bildirim_hedefi boolean NOT NULL DEFAULT true, gecersiz_zamani timestamptz, olusturma_zamani timestamptz NOT NULL DEFAULT now());
CREATE INDEX iletisim_bilgisi_taraf ON iletisim_bilgisi (taraf_ref);
CREATE UNIQUE INDEX iletisim_bilgisi_hedef ON iletisim_bilgisi (taraf_ref, tur) WHERE bildirim_hedefi;
CREATE OR REPLACE FUNCTION iletisim_gecmisi() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE t text; v text; e text;
BEGIN
  FOREACH t IN ARRAY ARRAY['Telefon', 'E-posta'] LOOP
    v := CASE t WHEN 'Telefon' THEN NEW.telefon ELSE NEW.eposta END;
    e := CASE WHEN TG_OP = 'UPDATE' THEN CASE t WHEN 'Telefon' THEN OLD.telefon ELSE OLD.eposta END END;
    IF v IS NOT NULL AND btrim(v) <> '' AND v IS DISTINCT FROM e AND NOT EXISTS (SELECT 1 FROM iletisim_bilgisi WHERE taraf_ref = NEW.kimlik AND tur = t AND deger = v AND bildirim_hedefi) THEN
      UPDATE iletisim_bilgisi SET bildirim_hedefi = false, gecerli = false, gecersiz_zamani = now() WHERE taraf_ref = NEW.kimlik AND tur = t AND bildirim_hedefi;
      INSERT INTO iletisim_bilgisi (taraf_ref, tur, deger) VALUES (NEW.kimlik, t, v);
    END IF;
  END LOOP;
  RETURN NEW;
END $$;
CREATE TRIGGER iletisim_gecmisi AFTER INSERT OR UPDATE OF telefon, eposta ON dosya_tarafi FOR EACH ROW EXECUTE FUNCTION iletisim_gecmisi();
INSERT INTO iletisim_bilgisi (taraf_ref, tur, deger) SELECT kimlik, 'Telefon', telefon FROM dosya_tarafi WHERE telefon IS NOT NULL AND btrim(telefon) <> '';
INSERT INTO iletisim_bilgisi (taraf_ref, tur, deger) SELECT kimlik, 'E-posta', eposta FROM dosya_tarafi WHERE eposta IS NOT NULL AND btrim(eposta) <> '';
GRANT SELECT, INSERT, UPDATE ON iletisim_bilgisi TO yatonet_uygulama;
