-- YG-1025: fatura PDF belgesi ve faturayı giren.
ALTER TABLE musteri_faturasi ADD COLUMN fatura_pdf_ref uuid REFERENCES belge (kimlik), ADD COLUMN fatura_giren_ref text REFERENCES kullanici_hesabi (kimlik);
