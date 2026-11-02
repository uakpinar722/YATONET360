-- Adım 2 ortak bileşenler: iş kartı ve onay zinciri, bildirim, duyuru, olağanüstü olay dönemi. YG-1626, YG-1629, YG-1632, YG-1635…YG-1637, YG-1034.

CREATE TABLE is_karti (
  kimlik           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  olusturma_zamani timestamptz NOT NULL DEFAULT now(),
  tur              text NOT NULL,
  kategori         text NOT NULL CHECK (kategori IN ('onay', 'islem', 'gorev')),
  baslik           text NOT NULL,
  ozet             text,
  oncelik          text NOT NULL DEFAULT 'Normal' CHECK (oncelik IN ('Kritik', 'Yüksek', 'Normal', 'Planlı')),
  hazirlayan_ref   text REFERENCES kullanici_hesabi (kimlik),
  -- Onay makamları sırasıyla rol kimlikleri; kademe sıfırdan başlar.
  zincir           text[] NOT NULL DEFAULT '{}',
  kademe           integer NOT NULL DEFAULT 0 CHECK (kademe >= 0),
  -- Onay dışı kartta işin sahibi kişi veya roldür.
  sahip_kullanici_ref text REFERENCES kullanici_hesabi (kimlik),
  sahip_rol_ref    text REFERENCES rol (kimlik),
  son_zaman        timestamptz,
  durum            text NOT NULL DEFAULT 'Bekliyor' CHECK (durum IN ('Bekliyor', 'İade Edildi', 'Onaylandı', 'Reddedildi', 'Tamamlandı')),
  nesne_turu       text,
  nesne_kimligi    text,
  kapanma_zamani   timestamptz,
  CHECK (kategori <> 'onay' OR cardinality(zincir) > 0),
  CHECK (kategori = 'onay' OR sahip_kullanici_ref IS NOT NULL OR sahip_rol_ref IS NOT NULL)
);
CREATE INDEX is_karti_acik ON is_karti (durum, son_zaman) WHERE kapanma_zamani IS NULL;

CREATE TABLE is_karti_adim (
  kimlik     bigserial PRIMARY KEY,
  is_ref     uuid NOT NULL REFERENCES is_karti (kimlik),
  kademe     integer NOT NULL,
  karar      text NOT NULL,
  gerekce    text,
  yapan_ref  text NOT NULL REFERENCES kullanici_hesabi (kimlik),
  rol_ref    text REFERENCES rol (kimlik),
  zaman      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX is_karti_adim_is ON is_karti_adim (is_ref, kimlik);

CREATE TABLE bildirim (
  kimlik         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  zaman          timestamptz NOT NULL DEFAULT now(),
  kullanici_ref  text NOT NULL REFERENCES kullanici_hesabi (kimlik),
  baslik         text NOT NULL,
  ozet           text,
  is_ref         uuid REFERENCES is_karti (kimlik),
  okunma_zamani  timestamptz
);
CREATE INDEX bildirim_kisi ON bildirim (kullanici_ref, zaman DESC);

CREATE TABLE duyuru (
  kimlik        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  yayim_zamani  timestamptz NOT NULL DEFAULT now(),
  baslik        text NOT NULL,
  govde         text,
  zorunlu       boolean NOT NULL DEFAULT false,
  kapsam        text NOT NULL CHECK (kapsam IN ('LGM', 'Dış', 'Tümü')),
  yayimlayan_ref text REFERENCES kullanici_hesabi (kimlik),
  bitis_zamani  timestamptz
);

CREATE TABLE duyuru_okuma (
  duyuru_ref    uuid NOT NULL REFERENCES duyuru (kimlik),
  kullanici_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik),
  zaman         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (duyuru_ref, kullanici_ref)
);

CREATE TABLE olaganustu_donem (
  kimlik     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  baslangic  timestamptz NOT NULL DEFAULT now(),
  bitis      timestamptz,
  ilan_eden  text REFERENCES kullanici_hesabi (kimlik),
  sebep      text
);

GRANT SELECT, INSERT, UPDATE ON is_karti, bildirim TO yatonet_uygulama;
GRANT SELECT, INSERT ON is_karti_adim, duyuru, duyuru_okuma TO yatonet_uygulama;
GRANT USAGE ON SEQUENCE is_karti_adim_kimlik_seq TO yatonet_uygulama;
GRANT SELECT ON olaganustu_donem TO yatonet_uygulama;
