-- TZ-9 BLD-08: taşımada gerekli izin ve varış yeri; izin girilirse yat sahibine BLD-08 bir kez gider.
ALTER TABLE kaldirma_tasima ADD COLUMN gerekli_izin text, ADD COLUMN varis_yeri text;
