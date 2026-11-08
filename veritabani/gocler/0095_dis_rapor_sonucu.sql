-- YG-398: dış uzman / muayene raporundaki sonuç ayrıca saklanır; test sonucu bundan eşlenir.
ALTER TABLE test_kaydi ADD COLUMN IF NOT EXISTS dis_rapor_sonucu text CHECK (dis_rapor_sonucu IN ('Uygun', 'Uygun Değil', 'Belirlenemedi'));
