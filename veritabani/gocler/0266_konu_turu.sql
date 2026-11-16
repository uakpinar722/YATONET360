-- YG-031: belge ve eğitim işleri öncelik değil konu türüdür; Planlı sınıfında tutulur.
ALTER TABLE acik_konu ADD COLUMN konu_turu text NOT NULL DEFAULT 'İş' CHECK (konu_turu IN ('İş', 'Belge', 'Eğitim'));
