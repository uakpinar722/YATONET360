-- YG-057: görev aşama, öncelik, kabul ölçütü ve gerekli belgeyle tanımlanır.
ALTER TABLE acik_konu ADD COLUMN asama text, ADD COLUMN oncelik text, ADD COLUMN kabul_olcutu text, ADD COLUMN gerekli_belge text;
