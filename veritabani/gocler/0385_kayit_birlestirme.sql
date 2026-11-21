-- YG-1244: mükerrer yat ve taraf kayıtlarının kontrollü birleştirilmesi. Otomatik silme/birleştirme yoktur; ana kaydı veri sahibi seçer,
-- ilişkiler taşınır ve taşınan satırlar kaydedilir, eski kimlik yönlendirme için korunur, birleştirme geri alınabilir.
ALTER TABLE yat ADD COLUMN birlestirilen_ana_ref uuid;
ALTER TABLE taraf ADD COLUMN birlestirilen_ana_ref uuid;
CREATE TABLE kayit_birlestirme (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), tur text NOT NULL CHECK (tur IN ('yat', 'taraf')), ana_ref uuid NOT NULL, eski_ref uuid NOT NULL,
  gerekce text NOT NULL, celisen_alanlar jsonb NOT NULL DEFAULT '[]', tasinan jsonb NOT NULL DEFAULT '[]',
  durum text NOT NULL DEFAULT 'Ana Kayda Bağlandı' CHECK (durum IN ('Ana Kayda Bağlandı', 'Geri Alındı')),
  yapan_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), zaman timestamptz NOT NULL DEFAULT now(),
  geri_alan_ref text REFERENCES kullanici_hesabi (kimlik), geri_alma_zamani timestamptz
);
CREATE INDEX kayit_birlestirme_eski ON kayit_birlestirme (eski_ref);
GRANT SELECT, INSERT, UPDATE ON kayit_birlestirme TO yatonet_uygulama;

-- Eski kayda bağlı tüm yabancı anahtar ilişkilerini ana kayda taşır; taşınan satır kimliklerini döndürür. Kimliksiz tabloda ilişki varsa durur.
CREATE FUNCTION kayit_birlestir(p_tur text, p_ana uuid, p_eski uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record; ids text[]; sonuc jsonb := '[]';
BEGIN
  IF p_tur NOT IN ('yat', 'taraf') THEN RAISE EXCEPTION 'Geçersiz kayıt türü'; END IF;
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

-- Taşınan satırları eski kayda geri bağlar ve yönlendirmeyi kaldırır.
CREATE FUNCTION kayit_birlestirme_geri_al(p_kayit uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE k record; t jsonb;
BEGIN
  SELECT * INTO k FROM kayit_birlestirme WHERE kimlik = p_kayit AND durum = 'Ana Kayda Bağlandı' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Birleştirme kaydı bulunamadı'; END IF;
  FOR t IN SELECT * FROM jsonb_array_elements(k.tasinan) LOOP
    EXECUTE format('UPDATE %s SET %I = $1 WHERE kimlik::text IN (SELECT jsonb_array_elements_text($2))', t->>'tablo', t->>'kolon') USING k.eski_ref, t->'kimlikler';
  END LOOP;
  EXECUTE format('UPDATE %I SET birlestirilen_ana_ref = NULL WHERE kimlik = $1', k.tur) USING k.eski_ref;
END $$;
GRANT EXECUTE ON FUNCTION kayit_birlestir(text, uuid, uuid), kayit_birlestirme_geri_al(uuid) TO yatonet_uygulama;

INSERT INTO durum_sozlugu (kayit_turu, durum, is_anlami, giris_kosulu, cikis_kosulu, yetkili_rol, izinli_gecisler, zorunlu_aciklama, sure_durur, otomatik_bildirim, musteri_adi) VALUES
  ('kayit_birlestirme', 'Ana Kayda Bağlandı', 'Mükerrer kayıt ana kayda bağlandı; ilişkileri taşındı, eski kimlik yönlendirme için korunuyor.', 'Operasyon Müdürü ana kaydı seçip gerekçeyle birleştirince', 'Birleştirme gerekçeyle geri alınınca Geri Alındı', 'Operasyon Müdürü', ARRAY['Geri Alındı']::text[], true, false, NULL, NULL),
  ('kayit_birlestirme', 'Geri Alındı', 'Uygulanmış işlem geri alındı; önceki durum geri getirildi.', 'Operasyon Müdürü birleştirmeyi geri alınca', 'Son durum; değişmez', 'Operasyon Müdürü', '{}'::text[], true, false, NULL, NULL);
