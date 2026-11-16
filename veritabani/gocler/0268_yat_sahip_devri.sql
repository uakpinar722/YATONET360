-- YG-091: yat satışı (sahip devri); önceki sahip silinmez, geçmişte kalır.
CREATE TABLE yat_sahip_gecmisi (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  yat_ref uuid NOT NULL REFERENCES yat (kimlik), onceki_sahip_ref uuid REFERENCES taraf (kimlik), yeni_sahip_ref uuid NOT NULL REFERENCES taraf (kimlik),
  devir_tarihi date NOT NULL, dayanak text NOT NULL, kaydeden_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), zaman timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX yat_sahip_gecmisi_yat ON yat_sahip_gecmisi (yat_ref);
GRANT SELECT, INSERT ON yat_sahip_gecmisi TO yatonet_uygulama;
