-- YG-1670: sağlık gözetiminde yalnız muayene tarihi ve sonuç tutulur (tanı ve sağlık bilgisi yok); OSGB'den gelen belge ve OSGB'ye iletilen bilgi kaydı.
CREATE TABLE saglik_gozetimi (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), personel_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), muayene_tarihi date NOT NULL,
  sonuc text NOT NULL CHECK (sonuc IN ('Çalışmaya Uygun', 'Çalışmaya Uygun Değil')), sonraki_muayene date, kaydeden_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), zaman timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE osgb_yazisma (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), yon text NOT NULL CHECK (yon IN ('OSGB''den Gelen', 'OSGB''ye İletilen')), konu text NOT NULL CHECK (length(trim(konu)) > 0),
  tarih date NOT NULL, belge_ref uuid REFERENCES belge (kimlik), kaydeden_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), zaman timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON saglik_gozetimi, osgb_yazisma TO yatonet_uygulama;
