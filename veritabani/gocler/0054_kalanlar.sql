-- İP-14: firma ön kayıt alanları, cayma iadesi, vefat temsilcisi, kurtarma sözleşmesi üretimi, izin belgesi.
ALTER TABLE kurulus ADD COLUMN mersis_no text, ADD COLUMN mahalle text, ADD COLUMN konum_turu text, ADD COLUMN yetkili_kisi text, ADD COLUMN tali_branslar text[] NOT NULL DEFAULT '{}', ADD COLUMN hizmet_bolgeleri text[] NOT NULL DEFAULT '{}', ADD COLUMN calisan_sayisi integer, ADD COLUMN referanslar text;
ALTER TABLE on_bilgilendirme_cayma_kaydi ADD COLUMN kanal text, ADD COLUMN iade_tutar_eur numeric(14,2), ADD COLUMN iade_durumu text NOT NULL DEFAULT 'Yok' CHECK (iade_durumu IN ('Yok', 'Hesap Bekliyor', 'Onayda', 'Ödeme Bekliyor', 'Ödendi')), ADD COLUMN iade_odeme_zamani timestamptz;
ALTER TABLE dosya ADD COLUMN vefat_temsilci text, ADD COLUMN vefat_temsilci_belge uuid REFERENCES belge (kimlik);
ALTER TABLE izin_talebi ADD COLUMN belge_ref uuid REFERENCES belge (kimlik);
ALTER TABLE belge_uretim DROP CONSTRAINT belge_uretim_tur_check;
ALTER TABLE belge_uretim ADD CONSTRAINT belge_uretim_tur_check CHECK (tur IN ('Fiyat Teklifi', 'Teknik Rapor', 'Onay Belgesi', 'Proforma', 'Ödeme Talebi', 'İş Emri', 'Teslim Tutanağı', 'Ödeme Sorumluluğu', 'Uyuşmazlık Paketi', 'Mutabakat Raporu', 'Kurtarma Sözleşmesi'));
