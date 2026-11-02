-- Belge deposu (YG-591…YG-611, YG-1269, YG-1270), onaylı metin kütüphanesi (YG-600, YG-626, YG-692).
CREATE TABLE dosya_siniri (
  grup       text PRIMARY KEY,
  uzantilar  text[] NOT NULL,
  azami_bayt bigint NOT NULL CHECK (azami_bayt > 0)
);
-- YG-1269: sınırlar sistem parametresidir.
INSERT INTO dosya_siniri VALUES
  ('Fotoğraf', ARRAY['jpg','jpeg','png','heic','dng'], 100 * 1024 * 1024::bigint),
  ('Video', ARRAY['mp4','mov'], 4096 * 1024 * 1024::bigint),
  ('Belge', ARRAY['pdf','docx','xlsx'], 200 * 1024 * 1024::bigint),
  ('Çizim', ARRAY['dwg','dxf'], 200 * 1024 * 1024::bigint),
  ('Mesaj Dışa Aktarımı', ARRAY['zip','txt'], 2048 * 1024 * 1024::bigint);

CREATE TABLE belge (
  kimlik        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ad            text NOT NULL CHECK (length(trim(ad)) > 0),
  belge_turu    text NOT NULL,
  bilgi_sinifi  text NOT NULL DEFAULT 'Gizli' CHECK (bilgi_sinifi IN ('Kamuya Açık', 'Kurumsal', 'Gizli', 'Kritik')),
  bag_turu      text NOT NULL,
  bag_kimligi   text NOT NULL,
  kaynak_kanali text NOT NULL CHECK (kaynak_kanali IN ('WhatsApp', 'E-posta', 'Elden', 'Firma Portalı', 'Sistem')),
  kaynak_kisi   text,
  belge_tarihi  date,
  olusturma_zamani timestamptz NOT NULL DEFAULT now(),
  olusturan_ref text REFERENCES kullanici_hesabi (kimlik)
);
-- YG-592: aynı kayda aynı adla yükleme yeni sürüm açar.
CREATE UNIQUE INDEX belge_ad_tekil ON belge (bag_turu, bag_kimligi, lower(ad));

CREATE TABLE belge_surum (
  kimlik          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  belge_ref       uuid NOT NULL REFERENCES belge (kimlik),
  surum_no        integer NOT NULL CHECK (surum_no > 0),
  dosya_adi       text NOT NULL,
  uzanti          text NOT NULL,
  boyut           bigint NOT NULL,
  ozet_sha256     text NOT NULL,
  depo_anahtari   text NOT NULL,
  tarama_kaynagi  text NOT NULL,
  durum           text NOT NULL DEFAULT 'Taslak' CHECK (durum IN ('Taslak', 'İncelemede', 'Onaylı', 'Yürürlükte', 'Arşiv', 'Yerine Geçti', 'İptal')),
  degisiklik_gerekcesi text,
  yururluk_tarihi date,
  dogrulama_kodu  text UNIQUE,
  yukleme_zamani  timestamptz NOT NULL DEFAULT now(),
  yukleyen_ref    text REFERENCES kullanici_hesabi (kimlik),
  onaylayan_ref   text REFERENCES kullanici_hesabi (kimlik),
  onay_zamani     timestamptz,
  is_karti_ref    uuid REFERENCES is_karti (kimlik),
  UNIQUE (belge_ref, surum_no)
);

-- YG-611: bağlantı anonim ve süresiz olamaz; alıcı kodla kimliğini doğrular.
CREATE TABLE paylasim_baglantisi (
  kimlik        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  surum_ref     uuid NOT NULL REFERENCES belge_surum (kimlik),
  belirtec_ozeti text NOT NULL UNIQUE,
  alici_eposta  text NOT NULL,
  izin          text NOT NULL DEFAULT 'Görüntüle' CHECK (izin IN ('Görüntüle', 'İndir')),
  son_gecerlilik timestamptz NOT NULL,
  olusturan_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik),
  olusturma_zamani timestamptz NOT NULL DEFAULT now(),
  iptal_zamani  timestamptz,
  kod_ozeti     text,
  kod_bitis     timestamptz,
  hatali_deneme integer NOT NULL DEFAULT 0,
  CHECK (son_gecerlilik <= olusturma_zamani + interval '30 days')
);

CREATE TABLE sablon_metni (
  kod    text NOT NULL,
  dil    text NOT NULL CHECK (dil IN ('tr', 'en')),
  surum  text NOT NULL DEFAULT 'R00',
  tur    text NOT NULL CHECK (tur IN ('Matbu', 'Bildirim', 'Onay')),
  baslik text,
  metin  text NOT NULL,
  durum  text NOT NULL DEFAULT 'Yürürlükte',
  PRIMARY KEY (kod, dil, surum)
);

GRANT SELECT ON dosya_siniri, sablon_metni TO yatonet_uygulama;
GRANT SELECT, INSERT ON belge, belge_surum, paylasim_baglantisi TO yatonet_uygulama;
-- Özgün dosyanın kimliği ve özeti değiştirilemez; yalnız yaşam döngüsü alanları güncellenir (YG-602, YG-603). Silme yetkisi yoktur.
GRANT UPDATE (durum, yururluk_tarihi, dogrulama_kodu, onaylayan_ref, onay_zamani, is_karti_ref) ON belge_surum TO yatonet_uygulama;
GRANT UPDATE (iptal_zamani, kod_ozeti, kod_bitis, hatali_deneme) ON paylasim_baglantisi TO yatonet_uygulama;
