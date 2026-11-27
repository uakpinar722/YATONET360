-- YG-446 (V-1132): sigorta görevlendirmesinde dosya yetkilisinin yetki sınırı ve onay kanalı; portaldan kullanıcı kapatma talebi.
CREATE TABLE sigorta_gorevlendirme (
  talep_ref uuid PRIMARY KEY REFERENCES talep (kimlik), sigortaci_adi text NOT NULL, hasar_no text NOT NULL, police_no text, dosya_yetkilisi text,
  yetki_siniri_eur numeric(14,2) CHECK (yetki_siniri_eur IS NULL OR yetki_siniri_eur >= 0), onay_kanali text NOT NULL DEFAULT 'YATONET 360' CHECK (onay_kanali IN ('YATONET 360', 'Sözleşmede Tanımlı Kurumsal E-posta')),
  istenen_hizmet text, kaydeden_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), zaman timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON sigorta_gorevlendirme TO yatonet_uygulama;
