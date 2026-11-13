-- YG-092, YG-515: dosya taraf ilişkisi başlangıç ve bitiş tarihli; bitmiş ilişki silinmez, bildirim almaz.
ALTER TABLE dosya_tarafi ADD COLUMN baslangic_zamani timestamptz, ADD COLUMN bitis_zamani timestamptz, ADD COLUMN bitis_gerekcesi text;
UPDATE dosya_tarafi SET baslangic_zamani = olusturma_zamani WHERE baslangic_zamani IS NULL;
ALTER TABLE dosya_tarafi ALTER COLUMN baslangic_zamani SET DEFAULT now();
