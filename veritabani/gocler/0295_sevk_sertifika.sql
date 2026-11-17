-- YG-1088: tedarikçi sevk bildiriminde irsaliyeden ayrı sertifika belgesi.
ALTER TABLE tedarik_sevki ADD COLUMN sertifika_ref uuid REFERENCES belge (kimlik);
