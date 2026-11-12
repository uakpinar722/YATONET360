-- YG-624: Garanti Belgesi Ek-1 kullanım ve bakım önerileri; üretim türü.
ALTER TABLE teslim_kaydi ADD COLUMN bakim_onerileri jsonb NOT NULL DEFAULT '[]';
GRANT UPDATE (bakim_onerileri) ON teslim_kaydi TO yatonet_uygulama;
