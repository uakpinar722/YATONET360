-- YG-278: kesinti sırasında alternatif formla alınan ihbarın form numarası; aynı form iki kez aktarılmaz.
ALTER TABLE talep ADD COLUMN alternatif_form_no text;
CREATE UNIQUE INDEX talep_alternatif_form ON talep (lower(alternatif_form_no)) WHERE alternatif_form_no IS NOT NULL;
