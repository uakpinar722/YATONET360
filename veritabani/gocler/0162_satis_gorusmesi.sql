-- YG-771: satış planı aylık görüşme hedefleri ve gerçekleşen görüşmeler.
CREATE TABLE satis_hedefi (donem text NOT NULL CHECK (donem ~ '^[0-9]{4}-[0-9]{2}$'), kullanici_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), hedef integer NOT NULL CHECK (hedef >= 0), giren_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), zaman timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (donem, kullanici_ref));
CREATE TABLE satis_gorusmesi (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), tarih date NOT NULL, kurum text NOT NULL, kurum_turu text NOT NULL CHECK (kurum_turu IN ('Sigorta Şirketi', 'Broker / Acente', 'Kurumsal Müşteri', 'Marina / Tesis', 'Diğer')),
  tur text NOT NULL CHECK (tur IN ('Yüz Yüze', 'Telefon', 'Video', 'E-posta')), sonuc text NOT NULL, sonraki_adim text, gorusen_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), olusturma_zamani timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON satis_hedefi TO yatonet_uygulama; GRANT SELECT, INSERT ON satis_gorusmesi TO yatonet_uygulama;
