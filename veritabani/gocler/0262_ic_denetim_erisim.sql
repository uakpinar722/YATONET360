-- YG-1679: denetçi ataması denetim süresi ve amacıyla sınırlı salt okunur erişim açar.
ALTER TABLE ic_denetim ADD COLUMN erisim_bitis date, ADD COLUMN erisim_amaci text, ADD COLUMN atayan_ref text REFERENCES kullanici_hesabi (kimlik);
