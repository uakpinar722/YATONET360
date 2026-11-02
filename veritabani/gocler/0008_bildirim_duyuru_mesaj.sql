-- Bildirim kuyruğu ve teslim izi (YG-507, YG-510, YG-513, YG-521, YG-523), duyuru yayını (YG-560…YG-562), iç mesaj (YG-1663), kanal tercihi (YG-519).
CREATE TABLE gonderim (
  kimlik          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  olusturma_zamani timestamptz NOT NULL DEFAULT now(),
  olay_anahtari   text NOT NULL,
  kullanici_ref   text REFERENCES kullanici_hesabi (kimlik),
  kanal           text NOT NULL CHECK (kanal IN ('E-posta', 'SMS', 'WhatsApp')),
  hedef           text NOT NULL,
  konu            text NOT NULL,
  metin           text NOT NULL,
  oncelik         text NOT NULL DEFAULT 'Normal',
  plan_zamani     timestamptz NOT NULL DEFAULT now(),
  durum           text NOT NULL DEFAULT 'Bekliyor' CHECK (durum IN ('Bekliyor', 'Gönderildi', 'Teslim Edildi', 'Okundu', 'İşlem Yapıldı', 'Başarısız')),
  deneme          integer NOT NULL DEFAULT 0,
  son_hata        text,
  gonderim_zamani timestamptz,
  UNIQUE (olay_anahtari, kanal, hedef)
);
CREATE INDEX gonderim_kuyruk ON gonderim (plan_zamani) WHERE durum = 'Bekliyor';

CREATE TABLE zamanlanmis_is (
  ad     text NOT NULL,
  anahtar text NOT NULL,
  zaman  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (ad, anahtar)
);

ALTER TABLE bildirim ADD COLUMN olay_anahtari text;
CREATE UNIQUE INDEX bildirim_tekil ON bildirim (kullanici_ref, olay_anahtari) WHERE olay_anahtari IS NOT NULL;

ALTER TABLE duyuru ADD COLUMN durum text NOT NULL DEFAULT 'Yayında' CHECK (durum IN ('Onay Bekliyor', 'Yayında', 'Reddedildi', 'İade Edildi'));
ALTER TABLE duyuru ADD COLUMN is_karti_ref uuid REFERENCES is_karti (kimlik);
CREATE INDEX duyuru_yayinda ON duyuru (durum, yayim_zamani DESC);

CREATE TABLE ic_mesaj (
  kimlik       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  zaman        timestamptz NOT NULL DEFAULT now(),
  gonderen_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik),
  alici_ref    text NOT NULL REFERENCES kullanici_hesabi (kimlik),
  metin        text NOT NULL CHECK (length(trim(metin)) > 0 AND length(metin) <= 4000),
  okunma_zamani timestamptz,
  CHECK (gonderen_ref <> alici_ref)
);
CREATE INDEX ic_mesaj_alici ON ic_mesaj (alici_ref, zaman DESC);
CREATE INDEX ic_mesaj_gonderen ON ic_mesaj (gonderen_ref, zaman DESC);

ALTER TABLE kullanici_hesabi ADD COLUMN bildirim_kanali text NOT NULL DEFAULT 'E-posta' CHECK (bildirim_kanali IN ('E-posta', 'SMS', 'WhatsApp'));

GRANT SELECT, INSERT, UPDATE ON gonderim, zamanlanmis_is, duyuru TO yatonet_uygulama;
GRANT SELECT, INSERT ON ic_mesaj TO yatonet_uygulama;
-- Mesaj silinemez, düzeltilemez; yalnız okundu işareti değişir (YG-1663).
GRANT UPDATE (okunma_zamani) ON ic_mesaj TO yatonet_uygulama;
