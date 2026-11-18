-- YG-1672: aylık iç denetim örneklemindeki dosya İç Denetim Müdürünce bir İç Denetçiye atanır.
ALTER TABLE ic_denetim_orneklemi ADD COLUMN denetci_ref text REFERENCES kullanici_hesabi (kimlik), ADD COLUMN atama_zamani timestamptz;
GRANT UPDATE (denetci_ref, atama_zamani) ON ic_denetim_orneklemi TO yatonet_uygulama;
