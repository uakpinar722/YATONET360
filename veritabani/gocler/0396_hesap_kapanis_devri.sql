-- YG-1054: belge sorumluluğu oluşturandan ayrı tutulur (oluşturan geçmiş kanıt olarak değişmez); hesap kapanışında yapılan her devir kaydedilir.
ALTER TABLE belge ADD COLUMN sorumlu_ref text REFERENCES kullanici_hesabi (kimlik);
CREATE TABLE hesap_kapanis_devri (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), kullanici_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik),
  tur text NOT NULL CHECK (tur IN ('Görev', 'Onay', 'Belge')), nesne text NOT NULL, yeni_sorumlu_ref text REFERENCES kullanici_hesabi (kimlik), aciklama text NOT NULL,
  zaman timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX hesap_kapanis_devri_k ON hesap_kapanis_devri (kullanici_ref);
GRANT SELECT, INSERT ON hesap_kapanis_devri TO yatonet_uygulama;
