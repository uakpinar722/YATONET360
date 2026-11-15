-- YG-437: kurumsal müşterinin görevlendirme kaydı (Müşteri Talimatı).
CREATE TABLE musteri_talimati (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  talimat_no text NOT NULL UNIQUE,
  dosya_ref uuid NOT NULL REFERENCES dosya (kimlik),
  kanal text NOT NULL CHECK (kanal IN ('Portal', 'E-posta', 'Ek-2 Kanalı')),
  mali_limit_eur numeric(14,2) NOT NULL CHECK (mali_limit_eur > 0),
  hedef_tarih date NOT NULL,
  talimat_metni text NOT NULL,
  kaydeden_ref text NOT NULL, olusturma_zamani timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON musteri_talimati TO yatonet_uygulama;
