-- YG-1688 (V-1125): Kalite Uzmanı yokken kontrol noktasını Kalite Yöneticisi bağımsızlık teyidiyle vekâleten serbest bırakır.
ALTER TABLE kontrol_noktasi ADD COLUMN vekaleten boolean NOT NULL DEFAULT false;
