-- YG-009: sözleşme numarası LGM-SZ-YYYY-NNNN; yıllık sayaç (numara_sayaci), kayıt anında verilir ve yeniden kullanılmaz.
ALTER TABLE sozlesme_kaydi ADD COLUMN sozlesme_no text UNIQUE;
CREATE FUNCTION sozlesme_no_ver() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE y text := to_char(coalesce(NEW.olusturma_zamani, now()) AT TIME ZONE 'Europe/Istanbul', 'YYYY'); n integer;
BEGIN
  IF NEW.sozlesme_no IS NULL THEN
    INSERT INTO numara_sayaci VALUES ('sozlesme-' || y, 1) ON CONFLICT (anahtar) DO UPDATE SET son = numara_sayaci.son + 1 RETURNING son INTO n;
    NEW.sozlesme_no := 'LGM-SZ-' || y || '-' || lpad(n::text, 4, '0');
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER sozlesme_no_ver BEFORE INSERT ON sozlesme_kaydi FOR EACH ROW EXECUTE FUNCTION sozlesme_no_ver();
DO $$ DECLARE r record; y text; n integer; BEGIN
  FOR r IN SELECT kimlik, olusturma_zamani FROM sozlesme_kaydi WHERE sozlesme_no IS NULL ORDER BY olusturma_zamani, kimlik LOOP
    y := to_char(r.olusturma_zamani AT TIME ZONE 'Europe/Istanbul', 'YYYY');
    INSERT INTO numara_sayaci VALUES ('sozlesme-' || y, 1) ON CONFLICT (anahtar) DO UPDATE SET son = numara_sayaci.son + 1 RETURNING son INTO n;
    UPDATE sozlesme_kaydi SET sozlesme_no = 'LGM-SZ-' || y || '-' || lpad(n::text, 4, '0') WHERE kimlik = r.kimlik;
  END LOOP;
END $$;
