-- YG-095: teknik rapor aynı yatın önceki onaylı raporlarına atıf yapabilir.
ALTER TABLE teknik_rapor ADD COLUMN IF NOT EXISTS onceki_raporlar uuid[] NOT NULL DEFAULT '{}';
