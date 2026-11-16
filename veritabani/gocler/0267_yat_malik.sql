-- YG-478: yat kaydında birden çok malik ve tek yetkili malik.
CREATE TABLE yat_malik (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  yat_ref uuid NOT NULL REFERENCES yat (kimlik), ad text NOT NULL CHECK (length(trim(ad)) > 0), taraf_ref uuid REFERENCES taraf (kimlik),
  pay_orani numeric(5,2) CHECK (pay_orani > 0 AND pay_orani <= 100), yetkili boolean NOT NULL DEFAULT false,
  ekleyen_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), olusturma_zamani timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX yat_malik_tek_yetkili ON yat_malik (yat_ref) WHERE yetkili;
GRANT SELECT, INSERT, UPDATE ON yat_malik TO yatonet_uygulama;
