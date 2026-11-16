-- YG-775: yönetim kararı türü, başarı ölçütü ve izleme dönemi.
ALTER TABLE toplanti_karar ADD COLUMN karar_turu text NOT NULL DEFAULT 'Diğer' CHECK (karar_turu IN ('Risk Kabulü', 'Kaynak Tahsisi', 'Öncelik', 'İyileştirme', 'Eğitim', 'Ek Denetim', 'Diğer')),
  ADD COLUMN basari_olcutu text, ADD COLUMN izleme_donemi text CHECK (izleme_donemi IS NULL OR izleme_donemi IN ('Haftalık', 'Aylık', 'Üç Aylık', 'Altı Aylık', 'Yıllık', 'Tek Sefer'));
