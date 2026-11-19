-- YG-1466: sosyal medya paylaşımından açılan şikâyet kaydı bağı.
ALTER TABLE sosyal_medya_kaydi ADD COLUMN sikayet_ref uuid REFERENCES garanti_sikayet (kimlik);
