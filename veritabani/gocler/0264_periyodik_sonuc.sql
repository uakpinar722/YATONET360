-- YG-1363: periyodik gözden geçirme sonucu; sabit karar seçenekleri ve kontrol listesi.
CREATE TABLE periyodik_sonuc (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  periyodik_ref uuid NOT NULL REFERENCES periyodik_is (kimlik), donem_tarihi date NOT NULL,
  karar text NOT NULL CHECK (karar IN ('Sürdür', 'Koşullu Sürdür', 'Değiştir', 'Askıya Al')),
  kontroller jsonb NOT NULL, aciklama text NOT NULL, kosul text, yeni_periyot_ay integer,
  karar_veren_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), zaman timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON periyodik_sonuc TO yatonet_uygulama;
