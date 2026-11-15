-- YG-045: hedef sürenin başlangıç olayı ve birimi.
ALTER TABLE dosya_sure ADD COLUMN baslangic_olayi text, ADD COLUMN sure_birimi text NOT NULL DEFAULT 'Saat' CHECK (sure_birimi IN ('Saat', 'Takvim Günü', 'Çalışma Günü'));
