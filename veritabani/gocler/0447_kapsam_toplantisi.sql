-- YG-1598: Kapsam Hazırlık Toplantısı kontrol listesi anlık görüntüsü ve kararın aktarım hedefi.
ALTER TABLE toplanti ADD COLUMN kontrol_listesi jsonb;
ALTER TABLE toplanti_karar ADD COLUMN aktarim_hedefi text CHECK (aktarim_hedefi IN ('Teknik Rapor', 'Metraj', 'Fiyat Teklifi', 'Bilgi'));
