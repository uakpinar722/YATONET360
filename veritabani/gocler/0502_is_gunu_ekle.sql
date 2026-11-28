-- YG-960 (V-1136): iş günüyle tanımlı karne göstergeleri için iş günü ekleme. İş günü uygulamadaki süre hesabıyla aynıdır (sure.ts bitisKaydir):
-- pazar ve tam gün resmi tatiller iş günü değildir; arife (yarım gün) iş günü sayılır.
CREATE FUNCTION is_gunu_ekle(p_tarih date, p_gun integer) RETURNS date LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE t date := p_tarih; n integer := 0;
BEGIN
  WHILE n < p_gun LOOP
    t := t + 1;
    IF extract(isodow FROM t) <> 7 AND NOT EXISTS (SELECT 1 FROM resmi_tatil r WHERE r.tarih = t AND NOT r.yarim_gun) THEN n := n + 1; END IF;
  END LOOP;
  RETURN t;
END $$;
GRANT EXECUTE ON FUNCTION is_gunu_ekle(date, integer) TO yatonet_uygulama;
