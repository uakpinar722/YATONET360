-- YG-1442: her revizyonun çizim görseli ve ölçeği kendi satırında saklanır; eski revizyon arşivden "GEÇERSİZ" damgasıyla alınır.
ALTER TABLE teknik_cizim_revizyonu ADD COLUMN belge_ref uuid REFERENCES belge (kimlik), ADD COLUMN olcek text;
UPDATE teknik_cizim_revizyonu r SET belge_ref = c.belge_ref, olcek = c.olcek FROM teknik_cizim c WHERE c.kimlik = r.cizim_ref AND r.rev_no = c.revizyon AND r.belge_ref IS NULL;
