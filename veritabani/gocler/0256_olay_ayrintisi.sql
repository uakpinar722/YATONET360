-- YG-1285: olay kaydının önemi, ana olay bağı, kapanış kanıtı ve adımları.
ALTER TABLE olay_kaydi ADD COLUMN onem text CHECK (onem IN ('Düşük', 'Orta', 'Yüksek', 'Kritik')), ADD COLUMN ana_olay_ref uuid REFERENCES olay_kaydi (kimlik), ADD COLUMN kapanis_ozeti text, ADD COLUMN kapanis_kaniti text, ADD COLUMN kapanis_zamani timestamptz;
CREATE TABLE olay_adimi (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  olay_ref uuid NOT NULL REFERENCES olay_kaydi (kimlik),
  tur text NOT NULL CHECK (tur IN ('Müdahale', 'Karar', 'İletişim')),
  metin text NOT NULL, zaman timestamptz NOT NULL DEFAULT now(),
  yapan_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik)
);
GRANT SELECT, INSERT ON olay_adimi TO yatonet_uygulama;
