-- YG-714: Teknik Raporda ek inceleme gerektiren alan sorusu.
ALTER TABLE teknik_rapor ADD COLUMN ek_inceleme_gerekir boolean, ADD COLUMN ek_inceleme_alani text;
