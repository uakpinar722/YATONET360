-- YG-133 (CEO 25.11.2026 öneri): malzeme veri föyü hasar bölgesine değil, bölgede uygulanacak malzemeye bağlanır; Onarım Yöntem Raporunda her malzeme için föy belgesi.
ALTER TABLE yontem_raporu ADD COLUMN veri_foyleri jsonb NOT NULL DEFAULT '[]';
