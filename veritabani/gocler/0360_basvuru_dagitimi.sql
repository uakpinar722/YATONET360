-- YG-1650 (A37): Dağıtım Bekleyen Başvurular — Firma Yönetimi Yöneticisi başvuruyu bir Sicil Sorumlusuna atar; ön incelemeye gönderimi atanan Sicil Sorumlusu yapar.
ALTER TABLE kurulus ADD COLUMN atanan_sicil_ref text REFERENCES kullanici_hesabi (kimlik);
