-- YG-286: FR-KLT-004…007 form türüne göre zorunlu açılan alanlar (Alan Sözlüğü).
ALTER TABLE test_kaydi ADD COLUMN personel_yetkinligi text, ADD COLUMN test_semasi text, ADD COLUMN devre_statusu text, ADD COLUMN deneme_profili text, ADD COLUMN isletim_kisiti text;
