-- YG-851: ödemeyi üstlenen tarafın yazılı taahhüdü; kısmi ödeme tahsilatla bağlanır, kalan yükümlülük ayrı izlenir.
CREATE TABLE odeme_taahhudu (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), dosya_ref uuid NOT NULL REFERENCES dosya (kimlik),
  ustlenen_turu text NOT NULL CHECK (ustlenen_turu IN ('Yat Sahibi', 'Kurumsal Müşteri', 'Sigorta Şirketi', 'Üçüncü Kişi')), ustlenen_adi text NOT NULL,
  tutar_eur numeric(14,2) NOT NULL CHECK (tutar_eur > 0), vade date, dayanak text NOT NULL,
  durum text NOT NULL DEFAULT 'Açık' CHECK (durum IN ('Açık', 'Kısmi Ödendi', 'Ödendi', 'İptal')),
  kaydeden_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), olusturma_zamani timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX odeme_taahhudu_dosya ON odeme_taahhudu (dosya_ref);
ALTER TABLE tahsilat ADD COLUMN taahhut_ref uuid REFERENCES odeme_taahhudu (kimlik);
GRANT SELECT, INSERT, UPDATE ON odeme_taahhudu TO yatonet_uygulama;
