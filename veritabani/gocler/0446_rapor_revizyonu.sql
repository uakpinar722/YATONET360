-- YG-711: teknik rapor revizyonu önceki sürüme bağlanır; revizyon nedeni tanımlı listeden seçilir (taraf talebi neden değildir).
ALTER TABLE teknik_rapor ADD COLUMN onceki_surum_ref uuid REFERENCES teknik_rapor (kimlik), ADD COLUMN revizyon_nedeni text CHECK (revizyon_nedeni IN ('Kontrol iadesi', 'Yeni teknik bulgu', 'Ölçüm veya yazım hatası')), ADD COLUMN revizyon_aciklamasi text;
