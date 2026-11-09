-- YG-1427, K-178: tedarikçi kalemi kapsam satırına bağlanır; fiyatı kartela kuralıyla teklife geçer.
ALTER TABLE tedarikci_teklif_kalemi ADD COLUMN IF NOT EXISTS satir_ref uuid REFERENCES kapsam_satiri (kimlik);
ALTER TABLE fiyat_teklifi_kalemi ADD COLUMN IF NOT EXISTS tedarikci_kalem_ref uuid REFERENCES tedarikci_teklif_kalemi (kimlik);
