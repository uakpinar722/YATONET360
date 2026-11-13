-- YG-305: görevlendirme kararının gerekçesi ve elenen adaylar; uygunluğu sistem değerlendirir, kararı yapan_ref verir.
ALTER TABLE gorevlendirme_kontrolu ADD COLUMN secim_gerekcesi text, ADD COLUMN elenen_adaylar jsonb NOT NULL DEFAULT '[]', ADD COLUMN degerlendiren text NOT NULL DEFAULT 'Sistem (görevlendirme kontrolü)';
