-- YG-1165: hassas içerikli görsel; maskeli kopya ayrı belgedir ve özgüne bağlanır.
ALTER TABLE belge ADD COLUMN hassas_icerik boolean NOT NULL DEFAULT false, ADD COLUMN hassasiyet_nedeni text, ADD COLUMN maskeli_kaynak_ref uuid REFERENCES belge (kimlik);
GRANT UPDATE ON belge TO yatonet_uygulama;
