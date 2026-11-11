-- YG-1262: eski liste değerleri ayrı sütunda korunur. YG-1266: bağlama noktası son teyit tarihi ve uyarılar. YG-1532/1533: model fotoğrafı ve teknik bilgi iç referans.
ALTER TABLE kurulus ADD COLUMN eski_liste_eslesme text, ADD COLUMN eski_liste_notu text, ADD COLUMN veri_notu text;
ALTER TABLE baglama_noktasi ADD COLUMN son_teyit_tarihi date, ADD COLUMN uyari text;
ALTER TABLE yat_marka_model ADD COLUMN foto_belge_ref uuid REFERENCES belge (kimlik), ADD COLUMN teknik_bilgi text, ADD COLUMN bilgi_kaynagi text, ADD COLUMN bilgi_guncelleyen_ref text REFERENCES kullanici_hesabi (kimlik), ADD COLUMN bilgi_zamani timestamptz;
GRANT UPDATE ON yat_marka_model, baglama_noktasi TO yatonet_uygulama;
