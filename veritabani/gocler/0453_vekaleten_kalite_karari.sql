-- YG-1688: görevde Kalite Uzmanı yokken kontrol kararını ilk dolu üst kademe olarak Kalite Yöneticisi bağımsızlık teyidiyle "Vekâleten" verir.
ALTER TABLE uygunsuzluk ADD COLUMN tasarruf_vekaleten boolean NOT NULL DEFAULT false, ADD COLUMN kapanis_vekaleten boolean NOT NULL DEFAULT false;
