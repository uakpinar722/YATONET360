-- YG-147: sözleşmeye göre öncelik bazlı taahhüt süresi (sigorta şirketi veya kurumsal müşteri).
CREATE TABLE sozlesme_hedef_suresi (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sigortaci_adi text, kurum_ref uuid REFERENCES kurumsal_kurum (kimlik),
  tur text NOT NULL CHECK (tur IN ('İlk Yanıt', 'Keşif', 'Teklif')),
  oncelik text NOT NULL CHECK (oncelik IN ('Kritik', 'Yüksek', 'Normal', 'Planlı')),
  saat numeric(6,1) NOT NULL CHECK (saat > 0),
  giren_ref text NOT NULL, olusturma_zamani timestamptz NOT NULL DEFAULT now(),
  CHECK ((sigortaci_adi IS NULL) <> (kurum_ref IS NULL))
);
CREATE UNIQUE INDEX sozlesme_hedef_suresi_tekil ON sozlesme_hedef_suresi (coalesce(lower(sigortaci_adi), kurum_ref::text), tur, oncelik);
GRANT SELECT, INSERT, UPDATE ON sozlesme_hedef_suresi TO yatonet_uygulama;
