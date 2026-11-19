-- YG-1423: itiraz ayrı kayıt numarasıyla izlenir.
ALTER TABLE garanti_sikayet ADD COLUMN itiraz_no text UNIQUE;
