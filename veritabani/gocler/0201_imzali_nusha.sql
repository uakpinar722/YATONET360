-- YG-589: marinada imzalatılan ön bilgilendirme ve cayma formu nüshaları.
ALTER TABLE fiyat_teklifi ADD COLUMN imzali_ob_ref uuid REFERENCES belge (kimlik);
ALTER TABLE on_bilgilendirme_cayma_kaydi ADD COLUMN cayma_belge_ref uuid REFERENCES belge (kimlik);
