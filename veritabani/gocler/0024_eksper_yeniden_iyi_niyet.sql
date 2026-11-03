-- YG-203: eksper raporu ile teklifin kalem kalem karşılaştırması.
CREATE TABLE eksper_karsilastirma (
  kalem_ref uuid PRIMARY KEY REFERENCES fiyat_teklifi_kalemi (kimlik), teklif_ref uuid NOT NULL REFERENCES fiyat_teklifi (kimlik), eksper_tutar_eur numeric(14,2) NOT NULL CHECK (eksper_tutar_eur >= 0), eksper_notu text, belge_ref uuid NOT NULL REFERENCES belge (kimlik), giren_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), zaman timestamptz NOT NULL DEFAULT now()
);
-- YG-204: onaylanmayan kalem için bir kez yazılı yeniden değerlendirme.
CREATE TABLE yeniden_degerlendirme (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), teklif_ref uuid NOT NULL REFERENCES fiyat_teklifi (kimlik), dosya_ref uuid NOT NULL REFERENCES dosya (kimlik), gerekce text NOT NULL, durum text NOT NULL DEFAULT 'Teyit Bekliyor' CHECK (durum IN ('Teyit Bekliyor', 'Gönderildi', 'Sonuçlandı')), talep_eden_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), olusturma_zamani timestamptz NOT NULL DEFAULT now(), gonderim_zamani timestamptz, sonuc_zamani timestamptz, sonuc_kanali text, sonuc_yetkili text, sonuc_belge_ref uuid REFERENCES belge (kimlik)
);
CREATE TABLE yeniden_degerlendirme_kalemi (talep_ref uuid NOT NULL REFERENCES yeniden_degerlendirme (kimlik), kalem_ref uuid NOT NULL REFERENCES fiyat_teklifi_kalemi (kimlik), sonuc text CHECK (sonuc IN ('Onaylandı', 'Onaylanmadı')), PRIMARY KEY (talep_ref, kalem_ref));
-- YG-175: iyi niyet kararı onaylanana kadar kayıt incelemede kalır.
ALTER TABLE garanti_sikayet ADD COLUMN IF NOT EXISTS iyi_niyet_orani numeric(7,2);
GRANT SELECT, INSERT, UPDATE ON eksper_karsilastirma, yeniden_degerlendirme, yeniden_degerlendirme_kalemi TO yatonet_uygulama;
