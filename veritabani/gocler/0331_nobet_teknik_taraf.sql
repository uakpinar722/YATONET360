-- YG-244: nöbet çizelgesinin teknik tarafı; Teknik Müdür Yardımcısı (yoksa Teknik Müdür) hazırlar, Operasyon Müdür Yardımcısına iletir. Süresinden sonra iletilen kayıt "gec" işaretlenir.
CREATE TABLE nobet_teknik_taraf (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  donem text NOT NULL CHECK (donem ~ '^\d{4}-\d{2}$'),
  vardiyalar jsonb NOT NULL,
  gec boolean NOT NULL DEFAULT false,
  hazirlayan_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik),
  iletim_zamani timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX nobet_teknik_taraf_donem ON nobet_teknik_taraf (donem, iletim_zamani DESC);
GRANT SELECT, INSERT ON nobet_teknik_taraf TO yatonet_uygulama;
