-- Kimlik, yetki ve işlem izi temeli. Tablo ve alan adları Alan Sözlüğü (LGM-2026-014) teknik adlarıdır (YG-1123).
-- Çalışma zamanı hesabı yatonet_uygulama'dır; işlem izine yalnız ekleyip okuyabilir (YG-1183, YG-1186).

CREATE TABLE deger_listesi (
  liste_kodu text NOT NULL,
  deger      text NOT NULL,
  aciklama   text,
  kaynak     text,
  sira       integer NOT NULL,
  PRIMARY KEY (liste_kodu, deger)
);

CREATE TABLE rol (
  kimlik                 text PRIMARY KEY CHECK (kimlik ~ '^ROL-[0-9]{3}$'),
  olusturma_zamani       timestamptz NOT NULL DEFAULT now(),
  rol_adi                text NOT NULL UNIQUE,
  rol_sahibi_birim       text NOT NULL,
  kademe                 text NOT NULL,
  kullanici_gruplari     text NOT NULL,
  ayricalikli_rol        boolean NOT NULL DEFAULT false,
  rol_durumu             text NOT NULL DEFAULT 'Aktif' CHECK (rol_durumu IN ('Aktif', 'Askıda', 'Kapalı'))
);

CREATE SEQUENCE kullanici_hesabi_no;

CREATE TABLE kullanici_hesabi (
  kimlik                  text PRIMARY KEY DEFAULT ('KUL-' || lpad(nextval('kullanici_hesabi_no')::text, 6, '0')),
  olusturma_zamani        timestamptz NOT NULL DEFAULT now(),
  guncelleme_zamani       timestamptz,
  surum                   integer NOT NULL DEFAULT 1 CHECK (surum >= 1),
  hesap_turu              text NOT NULL,
  kullanici_grubu         text NOT NULL,
  ad_soyad                text CHECK (length(ad_soyad) <= 100),
  kullanici_adi           text NOT NULL UNIQUE CHECK (length(kullanici_adi) <= 100),
  e_posta                 text CHECK (length(e_posta) <= 254),
  cep_telefonu            text CHECK (cep_telefonu ~ '^\+[0-9]{8,15}$'),
  parola_ozeti            text,
  dogrulama_yontemi       text NOT NULL CHECK (dogrulama_yontemi IN ('Doğrulama uygulaması (6 haneli kod)', 'SMS kodu')),
  totp_gizli_sifreli      text,
  totp_son_adim           bigint NOT NULL DEFAULT 0,
  ayricalikli_mi          boolean NOT NULL DEFAULT false,
  basarisiz_giris_sayisi  integer NOT NULL DEFAULT 0 CHECK (basarisiz_giris_sayisi >= 0),
  kilit_bitis_zamani      timestamptz,
  hesap_durumu            text NOT NULL DEFAULT 'Aktif' CHECK (hesap_durumu IN ('Aktif', 'Askıda', 'Kapalı')),
  erisim_baslangic        date NOT NULL DEFAULT current_date,
  erisim_bitis            date,
  son_giris_zamani        timestamptz,
  tercih_dili             text NOT NULL DEFAULT 'Türkçe' CHECK (tercih_dili IN ('Türkçe', 'İngilizce'))
);
CREATE UNIQUE INDEX kullanici_hesabi_e_posta_tekil ON kullanici_hesabi (lower(e_posta)) WHERE e_posta IS NOT NULL;
CREATE UNIQUE INDEX kullanici_hesabi_telefon_tekil ON kullanici_hesabi (cep_telefonu) WHERE cep_telefonu IS NOT NULL;

CREATE TABLE rol_atamasi (
  kimlik             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  olusturma_zamani   timestamptz NOT NULL DEFAULT now(),
  kullanici_ref      text NOT NULL REFERENCES kullanici_hesabi (kimlik),
  rol_ref            text NOT NULL REFERENCES rol (kimlik),
  baslangic_tarihi   date NOT NULL DEFAULT current_date,
  bitis_tarihi       date,
  atayan_ref         text REFERENCES kullanici_hesabi (kimlik),
  onaylayan_ref      text REFERENCES kullanici_hesabi (kimlik),
  atama_durumu       text NOT NULL DEFAULT 'Aktif' CHECK (atama_durumu IN ('Aktif', 'Askıda', 'Kapalı')),
  UNIQUE (kullanici_ref, rol_ref, baslangic_tarihi),
  -- YG-1008: atayan ile onaylayan aynı kişi olamaz
  CHECK (atayan_ref IS NULL OR atayan_ref <> onaylayan_ref),
  CHECK (bitis_tarihi IS NULL OR bitis_tarihi >= baslangic_tarihi)
);

-- YG-996: yetki matrisi. Yeni işlem, satır eklenmeden hiçbir role açılmaz.
CREATE TABLE rol_izni (
  rol_ref text NOT NULL REFERENCES rol (kimlik),
  izin    text NOT NULL,
  PRIMARY KEY (rol_ref, izin)
);

CREATE TABLE oturum (
  kimlik                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  olusturma_zamani          timestamptz NOT NULL DEFAULT now(),
  kullanici_ref             text NOT NULL REFERENCES kullanici_hesabi (kimlik),
  kanal                     text NOT NULL DEFAULT 'Web' CHECK (kanal IN ('Web', 'Mobil uygulama', 'API (hizmet hesabı)')),
  belirtec_ozeti            text NOT NULL UNIQUE,
  asama                     text NOT NULL CHECK (asama IN ('Kod Bekliyor', 'Tamam')),
  baslangic_zamani          timestamptz NOT NULL DEFAULT now(),
  son_islem_zamani          timestamptz NOT NULL DEFAULT now(),
  azami_bitis_zamani        timestamptz NOT NULL,
  bitis_zamani              timestamptz,
  bitis_nedeni              text CHECK (bitis_nedeni IN ('Çıkış', 'Hareketsizlik', 'Azami süre', 'Yetki değişikliği', 'Güvenlik sınırlaması')),
  kaynak_adres              text NOT NULL CHECK (length(kaynak_adres) <= 100),
  yeniden_dogrulama_zamani  timestamptz
);
CREATE INDEX oturum_kullanici ON oturum (kullanici_ref) WHERE bitis_zamani IS NULL;

CREATE TABLE sms_kodu (
  kimlik          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  oturum_ref      uuid NOT NULL REFERENCES oturum (kimlik),
  kod_ozeti       text NOT NULL,
  gonderim_zamani timestamptz NOT NULL DEFAULT now(),
  son_gecerlilik  timestamptz NOT NULL,
  kullanildi      boolean NOT NULL DEFAULT false
);

CREATE TABLE denetim_izi (
  kimlik           bigserial PRIMARY KEY,
  olusturma_zamani timestamptz NOT NULL DEFAULT clock_timestamp(),
  aktor_ref        text REFERENCES kullanici_hesabi (kimlik),
  oturum_ref       uuid,
  olay_zamani      timestamptz NOT NULL DEFAULT clock_timestamp(),
  eylem            text NOT NULL,
  nesne_turu       text,
  nesne_kimligi    text,
  eski_deger       jsonb,
  yeni_deger       jsonb,
  kaynak_kanal     text,
  kaynak_adres     text,
  sonuc            text NOT NULL CHECK (sonuc IN ('Başarılı', 'Başarısız')),
  gerekce          text,
  iliski_kimligi   text,
  onceki_butunluk  text,
  butunluk_degeri  text NOT NULL
);
CREATE INDEX denetim_izi_aktor ON denetim_izi (aktor_ref, kimlik DESC);

-- Zincirleme bütünlük: her satır bir öncekinin özetini içerir; sonradan değişiklik zinciri kırar.
CREATE FUNCTION denetim_izi_zincirle() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE onceki text;
BEGIN
  PERFORM pg_advisory_xact_lock(360360);
  SELECT butunluk_degeri INTO onceki FROM denetim_izi ORDER BY kimlik DESC LIMIT 1;
  NEW.onceki_butunluk := onceki;
  NEW.olusturma_zamani := clock_timestamp();
  NEW.butunluk_degeri := encode(sha256(convert_to(concat_ws('|',
    coalesce(onceki, 'BASLANGIC'), NEW.kimlik, NEW.aktor_ref, NEW.oturum_ref, NEW.olay_zamani, NEW.eylem,
    NEW.nesne_turu, NEW.nesne_kimligi, NEW.eski_deger, NEW.yeni_deger, NEW.kaynak_kanal, NEW.kaynak_adres,
    NEW.sonuc, NEW.gerekce, NEW.iliski_kimligi), 'UTF8')), 'hex');
  RETURN NEW;
END $$;
CREATE TRIGGER denetim_izi_zincir BEFORE INSERT ON denetim_izi FOR EACH ROW EXECUTE FUNCTION denetim_izi_zincirle();

CREATE FUNCTION denetim_izi_degismez() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'İşlem izi değiştirilemez ve silinemez';
END $$;
CREATE TRIGGER denetim_izi_koruma BEFORE UPDATE OR DELETE ON denetim_izi FOR EACH ROW EXECUTE FUNCTION denetim_izi_degismez();
CREATE TRIGGER denetim_izi_koruma_t BEFORE TRUNCATE ON denetim_izi FOR EACH STATEMENT EXECUTE FUNCTION denetim_izi_degismez();

GRANT SELECT ON deger_listesi, rol, rol_izni TO yatonet_uygulama;
GRANT SELECT, INSERT, UPDATE ON kullanici_hesabi, rol_atamasi, oturum, sms_kodu TO yatonet_uygulama;
GRANT SELECT, INSERT ON denetim_izi TO yatonet_uygulama;
GRANT USAGE ON SEQUENCE denetim_izi_kimlik_seq, kullanici_hesabi_no TO yatonet_uygulama;
