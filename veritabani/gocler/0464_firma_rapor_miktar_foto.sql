-- YG-427: firma teknik raporunda miktarlar ve fotoğraflar; LGM teknik rapor önerisine kendiliğinden aktarılır.
ALTER TABLE firma_teknik_raporu ADD COLUMN miktarlar jsonb NOT NULL DEFAULT '[]', ADD COLUMN fotograflar uuid[] NOT NULL DEFAULT '{}';
