-- YG-1409–1412, YG-1504: sistem içi destek talebi (DST numarası), D1–D4 seviyesi, yanıt ve çözüm son zamanı, çözüm kaydı, kullanıcı doğrulaması, ilişkili talep, talep yazışması.
CREATE TABLE IF NOT EXISTS destek_talebi (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), talep_no text NOT NULL UNIQUE, acan_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), tur text NOT NULL CHECK (tur IN ('Hata', 'Öneri', 'Soru')),
  hizmet text, ekran text, dosya_ref uuid REFERENCES dosya (kimlik), nesne_turu text, nesne_kimligi text, belirti text NOT NULL, etki text, beklenen text, ekran_goruntusu_ref uuid REFERENCES belge (kimlik),
  etkilenen_sayi integer NOT NULL DEFAULT 1 CHECK (etkilenen_sayi >= 1), sistem_kullanilamiyor boolean NOT NULL DEFAULT false, kritik_surec boolean NOT NULL DEFAULT false, guvenlik boolean NOT NULL DEFAULT false,
  veri_butunlugu boolean NOT NULL DEFAULT false, musteri_mali boolean NOT NULL DEFAULT false, seviye text NOT NULL CHECK (seviye IN ('D1', 'D2', 'D3', 'D4')),
  yanit_son timestamptz NOT NULL, gecici_cozum_son timestamptz, cozum_son timestamptz, yanit_zamani timestamptz, gecici_cozum_zamani timestamptz,
  durum text NOT NULL DEFAULT 'Açık' CHECK (durum IN ('Açık', 'Yanıtlandı', 'Çözüldü', 'Kapalı')), ilgili_ref uuid REFERENCES destek_talebi (kimlik), atanan_ref text REFERENCES kullanici_hesabi (kimlik),
  yapilan_islem text, degisen_kayit text, dogrulama_yontemi text, kullaniciya_sonuc text, cozum_zamani timestamptz, cozen_ref text REFERENCES kullanici_hesabi (kimlik),
  kullanici_dogrulama text CHECK (kullanici_dogrulama IN ('Çözüldü', 'Sorun Sürüyor')), kapanis_notu text, kapanis_zamani timestamptz, olusturma_zamani timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS destek_acik ON destek_talebi (durum) WHERE durum <> 'Kapalı';
CREATE TABLE IF NOT EXISTS destek_mesaji (kimlik bigserial PRIMARY KEY, talep_ref uuid NOT NULL REFERENCES destek_talebi (kimlik), yazan_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), metin text NOT NULL, zaman timestamptz NOT NULL DEFAULT now());
GRANT SELECT, INSERT, UPDATE ON destek_talebi TO yatonet_uygulama; GRANT SELECT, INSERT ON destek_mesaji TO yatonet_uygulama; GRANT USAGE ON SEQUENCE destek_mesaji_kimlik_seq TO yatonet_uygulama;
