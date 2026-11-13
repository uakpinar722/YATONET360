-- YG-712: Teknik Raporda beyan–bulgu uyumu.
ALTER TABLE teknik_rapor ADD COLUMN beyan_bulgu_uyumu text CHECK (beyan_bulgu_uyumu IN ('Uyumlu', 'Kısmen Uyumlu', 'Uyumsuz')), ADD COLUMN uyum_aciklamasi text;
