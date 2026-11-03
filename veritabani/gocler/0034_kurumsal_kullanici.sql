-- YG-1563: kurumsal müşteri kendi kullanıcısını ekler; rol İzleyici, Talep Açan, Onaylayan; onay sınırı Ek-2 sınırını aşmaz.
CREATE TABLE kurumsal_kurum (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), taraf_ref uuid NOT NULL UNIQUE REFERENCES taraf (kimlik), unvan text NOT NULL, ek2_onay_siniri numeric(14,2) NOT NULL CHECK (ek2_onay_siniri >= 0), kaydeden_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), olusturma_zamani timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE kurumsal_kullanici (
  kullanici_ref text PRIMARY KEY REFERENCES kullanici_hesabi (kimlik), kurum_ref uuid NOT NULL REFERENCES kurumsal_kurum (kimlik), rol text NOT NULL CHECK (rol IN ('İzleyici', 'Talep Açan', 'Onaylayan')), onay_siniri numeric(14,2) CHECK (onay_siniri >= 0), yetkili boolean NOT NULL DEFAULT false, ekleyen_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), olusturma_zamani timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX kurumsal_kullanici_kurum ON kurumsal_kullanici (kurum_ref);
GRANT SELECT, INSERT, UPDATE ON kurumsal_kurum, kurumsal_kullanici TO yatonet_uygulama;
