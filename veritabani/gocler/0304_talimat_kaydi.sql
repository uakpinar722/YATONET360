-- YG-569, YG-570: dış kanaldan gelen talimat ve kararların kaynak kaydı; özgün metin değişmez, aktaranın notu ayrıdır.
CREATE TABLE talimat_kaydi (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), dosya_ref uuid NOT NULL REFERENCES dosya (kimlik),
  kanal text NOT NULL CHECK (kanal IN ('E-posta', 'Telefon', 'SMS', 'WhatsApp', 'WhatsApp Grubu', 'Yüz Yüze', 'Diğer')),
  tur text NOT NULL DEFAULT 'Talimat' CHECK (tur IN ('Talimat', 'Karar', 'Bilgi')),
  gonderen text NOT NULL, alinma_zamani timestamptz NOT NULL, ozgun_metin text NOT NULL CHECK (length(trim(ozgun_metin)) > 0),
  belge_ref uuid REFERENCES belge (kimlik), aktaran_notu text, kaydeden_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), kayit_zamani timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX talimat_kaydi_dosya ON talimat_kaydi (dosya_ref);
GRANT SELECT, INSERT ON talimat_kaydi TO yatonet_uygulama;
