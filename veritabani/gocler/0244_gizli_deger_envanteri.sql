-- YG-1197: gizli değer ve sertifika sahibi, rotasyon (değerin kendisi tutulmaz).
ALTER TABLE bt_varligi DROP CONSTRAINT bt_varligi_tur_check;
ALTER TABLE bt_varligi ADD CONSTRAINT bt_varligi_tur_check CHECK (tur IN ('Donanım', 'Lisans', 'Alan Adı', 'Sertifika', 'Gizli Değer', 'Diğer'));
ALTER TABLE bt_varligi ADD COLUMN sahip_rol text, ADD COLUMN son_yenileme date, ADD COLUMN rotasyon_gun integer CHECK (rotasyon_gun > 0);
