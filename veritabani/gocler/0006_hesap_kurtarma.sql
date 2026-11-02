-- Hesap kurtarma: cihaz kaybında ikinci faktörün kontrollü sıfırlanması. YG-1150, YG-1156, YG-1649, YG-1699, A32-3.
CREATE TABLE hesap_kurtarma (
  kimlik            text PRIMARY KEY CHECK (kimlik ~ '^DST-[0-9]{4}-[0-9]{4,}$'),
  olusturma_zamani  timestamptz NOT NULL DEFAULT now(),
  acan_ref          text NOT NULL REFERENCES kullanici_hesabi (kimlik),
  kullanici_ref     text NOT NULL REFERENCES kullanici_hesabi (kimlik),
  kimlik_teyidi     text NOT NULL CHECK (length(trim(kimlik_teyidi)) > 0),
  neden             text NOT NULL CHECK (length(trim(neden)) > 0),
  is_karti_ref      uuid REFERENCES is_karti (kimlik),
  durum             text NOT NULL DEFAULT 'Teyit Bekliyor' CHECK (durum IN ('Teyit Bekliyor', 'Uygulandı', 'Reddedildi', 'İade Edildi')),
  uygulama_zamani   timestamptz
);
CREATE INDEX hesap_kurtarma_kisi ON hesap_kurtarma (kullanici_ref, olusturma_zamani DESC);
GRANT SELECT, INSERT, UPDATE ON hesap_kurtarma TO yatonet_uygulama;
