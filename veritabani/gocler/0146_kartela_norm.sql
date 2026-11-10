-- YG-860: işçilik normu ve fire oranı kartela ana verisinde; belgelere yazılmaz.
ALTER TABLE kartela_kalemi ADD COLUMN iscilik_normu_saat numeric(10,3) CHECK (iscilik_normu_saat > 0), ADD COLUMN fire_orani numeric(5,2) CHECK (fire_orani >= 0 AND fire_orani < 100), ADD COLUMN norm_kaynagi text;
