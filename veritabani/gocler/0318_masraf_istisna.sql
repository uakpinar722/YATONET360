-- YG-921: konaklama sınırını aşan kısım için TİD istisna onayı gerekçesi.
ALTER TABLE personel_masraf_fisi ADD COLUMN istisna_gerekcesi text;
ALTER TABLE personel_masraf_fisi DROP CONSTRAINT IF EXISTS personel_masraf_fisi_personel_ref_belge_ozeti_key;
CREATE UNIQUE INDEX personel_masraf_fisi_belge_tek ON personel_masraf_fisi (personel_ref, belge_ozeti) WHERE durum <> 'Reddedildi';
