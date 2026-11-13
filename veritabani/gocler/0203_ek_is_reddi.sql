-- YG-726: Ek İş Reddi ve Kullanım Sınırı Bildirimi.
CREATE TABLE ek_is_reddi (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), dosya_ref uuid NOT NULL REFERENCES dosya (kimlik), onay_talebi_ref uuid NOT NULL UNIQUE REFERENCES onay_talebi (kimlik), teklif_no text NOT NULL,
  yapilmayan_is text NOT NULL, teknik_etki text NOT NULL, kullanim_siniri text NOT NULL, onerilen_kontrol text NOT NULL, olusturan_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), olusturma_zamani timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON ek_is_reddi TO yatonet_uygulama;
