-- YG-1356, YG-825, YG-955: TCMB döviz kuru (1 birim = x TL); TCMB yayını günlük okunur, erişilemezse Muhasebe ve Finans elle girer.
CREATE TABLE doviz_kuru (
  tarih date NOT NULL, para_birimi text NOT NULL CHECK (para_birimi IN ('EUR', 'USD', 'GBP')),
  alis numeric(12,4), satis numeric(12,4) NOT NULL CHECK (satis > 0),
  kaynak text NOT NULL CHECK (kaynak IN ('TCMB', 'Elle')), giren_ref text REFERENCES kullanici_hesabi (kimlik), zaman timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tarih, para_birimi)
);
