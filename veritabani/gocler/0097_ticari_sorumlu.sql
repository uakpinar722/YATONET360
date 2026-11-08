-- YG-1600: dosyanın Ticari Sorumlusu Muhasebe ve Finans Yöneticisince atanır.
ALTER TABLE dosya ADD COLUMN IF NOT EXISTS ticari_sorumlu_ref text REFERENCES kullanici_hesabi (kimlik);
