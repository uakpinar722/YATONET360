-- YG-1398, YG-1399, YG-1400, YG-940, YG-936 (VAR-171, V-1109): puanlı ve süreli eğitim senaryoları, denemeler, sıfırlama ve yeni personel kapısı.
CREATE TABLE egitim_senaryosu (
  kod text PRIMARY KEY, ad text NOT NULL, ozet text NOT NULL, sira integer NOT NULL,
  sure_dk integer NOT NULL CHECK (sure_dk > 0), gecme_orani numeric NOT NULL DEFAULT 0.8 CHECK (gecme_orani > 0 AND gecme_orani <= 1),
  dosya jsonb NOT NULL DEFAULT '{}', adimlar jsonb NOT NULL CHECK (jsonb_array_length(adimlar) > 0), aktif boolean NOT NULL DEFAULT true
);
CREATE TABLE egitim_denemesi (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), kullanici_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), senaryo_kod text NOT NULL REFERENCES egitim_senaryosu (kod),
  baslangic timestamptz NOT NULL DEFAULT now(), bitis timestamptz, adim integer NOT NULL DEFAULT 0, puan integer NOT NULL DEFAULT 0, azami integer NOT NULL CHECK (azami > 0),
  durdurma integer NOT NULL DEFAULT 0, cevaplar jsonb NOT NULL DEFAULT '[]',
  durum text NOT NULL DEFAULT 'Sürüyor' CHECK (durum IN ('Sürüyor', 'Başarılı', 'Başarısız', 'Sıfırlandı'))
);
CREATE UNIQUE INDEX egitim_denemesi_suren ON egitim_denemesi (kullanici_ref, senaryo_kod) WHERE durum = 'Sürüyor';
-- Başarı kaydı canlı veritabanında tutulur; eğitim hesapları canlıdan ayrı olduğu için e-postayla eşleşir.
CREATE TABLE egitim_basarisi (
  kimlik bigserial PRIMARY KEY, eposta text NOT NULL, senaryo_kod text NOT NULL, puan integer NOT NULL, azami integer NOT NULL, sure_sn integer NOT NULL,
  zaman timestamptz NOT NULL DEFAULT now(), UNIQUE (eposta, senaryo_kod)
);
INSERT INTO sistem_parametresi (kod, deger, aciklama) VALUES ('egitim_kapisi_senaryo', 3, 'Yeni personelin ilk gerçek dosyasından önce başarıyla tamamlaması gereken farklı eğitim senaryosu sayısı; geçerlilik tarihinden sonra işe girenlere uygulanır (YG-1399, V-1109).') ON CONFLICT (kod) DO NOTHING;
GRANT SELECT ON egitim_senaryosu TO yatonet_uygulama;
GRANT SELECT, INSERT, UPDATE ON egitim_denemesi, egitim_basarisi TO yatonet_uygulama;
GRANT USAGE ON SEQUENCE egitim_basarisi_kimlik_seq TO yatonet_uygulama;
