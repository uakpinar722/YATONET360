-- YG-357, YG-359: Pasif nedeni ve statü yükseltme kanıtı.
ALTER TABLE kurulus ADD COLUMN pasif_nedeni text CHECK (pasif_nedeni IN ('Firma Talebi', 'Hareketsizlik')), ADD COLUMN son_iyilestirme_kaniti_ref uuid REFERENCES belge (kimlik);
