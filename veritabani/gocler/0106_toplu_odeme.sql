-- YG-902: sigortacının toplu ödemesi dağılım bildirimiyle dosyalara dağıtılır.
CREATE TABLE sigorta_toplu_odeme (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), sigortaci_adi text NOT NULL, toplam_eur numeric(14,2) NOT NULL CHECK (toplam_eur > 0), tarih date NOT NULL, banka_referansi text NOT NULL UNIQUE, bildirim_no text NOT NULL, giren_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), olusturma_zamani timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE tahsilat ADD COLUMN IF NOT EXISTS toplu_odeme_ref uuid REFERENCES sigorta_toplu_odeme (kimlik);
GRANT SELECT, INSERT ON sigorta_toplu_odeme TO yatonet_uygulama;
