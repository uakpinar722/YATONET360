-- İP-12: kayıt değişikliği izi (YG-1183), yedek kaydı (YG-1274–1279), olay sürümü (YG-1281, YG-1283), işlem anahtarı (YG-1310), sistem nabzı (YG-1186), e-posta değişikliği (YG-1156).
CREATE TABLE kayit_degisikligi (
  kimlik bigserial PRIMARY KEY, zaman timestamptz NOT NULL DEFAULT now(), tablo text NOT NULL, nesne text, islem text NOT NULL, aktor text, degisen jsonb NOT NULL
);
CREATE INDEX kayit_degisikligi_nesne ON kayit_degisikligi (tablo, nesne, zaman DESC);
CREATE FUNCTION kayit_iz_gizli(k text) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$ SELECT k ~* '(parola|ozet|gizli|belirtec|totp|tckn|kimlik_no|telefon|eposta|e_posta|iban|brut|adres|ad_soyad|kisi_adi)' $$;
CREATE FUNCTION kayit_iz() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE e jsonb := CASE WHEN TG_OP = 'INSERT' THEN '{}'::jsonb ELSE to_jsonb(OLD) END; y jsonb := CASE WHEN TG_OP = 'DELETE' THEN '{}'::jsonb ELSE to_jsonb(NEW) END; d jsonb;
BEGIN
  SELECT jsonb_object_agg(k, CASE WHEN kayit_iz_gizli(k) THEN jsonb_build_object('eski', '***', 'yeni', '***') ELSE jsonb_build_object('eski', e -> k, 'yeni', y -> k) END) INTO d
    FROM (SELECT k FROM jsonb_object_keys(e || y) k WHERE (e -> k) IS DISTINCT FROM (y -> k) AND k NOT IN ('guncelleme_zamani', 'surum')) x;
  IF d IS NOT NULL AND TG_OP <> 'INSERT' THEN
    INSERT INTO kayit_degisikligi (tablo, nesne, islem, aktor, degisen) VALUES (TG_TABLE_NAME, coalesce(y ->> 'kimlik', e ->> 'kimlik', y ->> 'kullanici_ref', e ->> 'kullanici_ref'), TG_OP, substring(current_query() from '^/\*aktor=([^*]*)\*/'), d);
  END IF;
  RETURN NULL;
END $$;
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['dosya','dosya_tarafi','yat','taraf','fiyat_teklifi','fiyat_teklifi_kalemi','is_emri','hakedis','hakedis_mahsubu','odeme_talimati','musteri_faturasi','tahsilat','banka_hesabi','kurulus','rol_atamasi','kullanici_hesabi','sozlesme_kaydi','personel_karti','izin_talebi','disiplin_kaydi','yat_yetkilisi_kaydi','veri_ihlali','ilgili_kisi_basvurusu','imha_listesi','hukuki_koruma'] LOOP
    IF to_regclass(t) IS NOT NULL THEN EXECUTE format('CREATE TRIGGER %I AFTER UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION kayit_iz()', t || '_iz', t); END IF;
  END LOOP;
END $$;
CREATE FUNCTION kayit_iz_degismez() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Kayıt izi değiştirilemez ve silinemez'; END $$;
CREATE TRIGGER kayit_degisikligi_koruma BEFORE UPDATE OR DELETE ON kayit_degisikligi FOR EACH ROW EXECUTE FUNCTION kayit_iz_degismez();
GRANT SELECT ON kayit_degisikligi TO yatonet_uygulama;
CREATE TABLE yedek_kaydi (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), tur text NOT NULL CHECK (tur IN ('Dört Saatlik', 'Gece Tam')), baslangic timestamptz NOT NULL DEFAULT now(), bitis timestamptz, dosya text, boyut bigint, ozet_sha256 text, tablo_sayisi integer, satir_sayisi bigint, belge_sayisi integer, ikinci_konum boolean NOT NULL DEFAULT false, durum text NOT NULL DEFAULT 'Sürüyor' CHECK (durum IN ('Sürüyor', 'Başarılı', 'Eksik Set', 'Başarısız', 'Döngüden Çıktı')), hata text
);
CREATE TABLE geri_yukleme_testi (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), tur text NOT NULL CHECK (tur IN ('Örnek Kayıt', 'Tam Sistem', 'Felaket Tatbikatı')), yedek_ref uuid REFERENCES yedek_kaydi (kimlik), kurtarma_dakika integer NOT NULL, veri_kaybi_dakika integer NOT NULL, kayit_sayisi_tutarli boolean NOT NULL, belge_erisimi boolean NOT NULL, yetki_tutarli boolean NOT NULL, sonuc text NOT NULL CHECK (sonuc IN ('Başarılı', 'Başarısız')), not_metni text, kaydeden_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), zaman timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE olay_kaydi ADD COLUMN etki jsonb, ADD COLUMN surum integer NOT NULL DEFAULT 0, ADD COLUMN veri_ihlali_ref uuid REFERENCES veri_ihlali (kimlik), ADD COLUMN aciklama_yetkilisi_ref text REFERENCES kullanici_hesabi (kimlik), ADD COLUMN yanit_zamani timestamptz, ADD COLUMN gecici_cozum_zamani timestamptz, ADD COLUMN durum text NOT NULL DEFAULT 'Açık' CHECK (durum IN ('Açık', 'Kapalı'));
CREATE TABLE olay_surumu (olay_ref uuid NOT NULL REFERENCES olay_kaydi (kimlik), surum integer NOT NULL, etki jsonb NOT NULL, guncelleyen_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), zaman timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (olay_ref, surum));
CREATE TABLE islem_anahtari (anahtar text PRIMARY KEY, kod integer NOT NULL, yanit text NOT NULL, zaman timestamptz NOT NULL DEFAULT now());
CREATE TABLE sistem_nabzi (kimlik integer PRIMARY KEY CHECK (kimlik = 1), zaman timestamptz NOT NULL);
CREATE TABLE eposta_degisikligi (kullanici_ref text PRIMARY KEY REFERENCES kullanici_hesabi (kimlik), yeni_eposta text NOT NULL, kod_ozeti text NOT NULL, son_gecerlilik timestamptz NOT NULL, deneme integer NOT NULL DEFAULT 0);
GRANT SELECT, INSERT, UPDATE ON yedek_kaydi, geri_yukleme_testi, olay_surumu, islem_anahtari, sistem_nabzi, eposta_degisikligi TO yatonet_uygulama;
GRANT DELETE ON islem_anahtari, eposta_degisikligi TO yatonet_uygulama;
GRANT UPDATE ON olay_kaydi TO yatonet_uygulama;
