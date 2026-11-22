-- YG-503, YG-1452: çekim zamanı sunucu saatine göre doğrulanır; çevrim dışı çekimde cihazın yerel sıra numarası ve eşitleme zamanı tutulur.
ALTER TABLE gorsel_kanit ADD COLUMN cihaz_saati_farki_sn integer, ADD COLUMN saat_dogrulamasi text CHECK (saat_dogrulamasi IN ('Sunucu Saati', 'Doğrulandı', 'Sapma Düzeltildi', 'Doğrulanamadı')),
  ADD COLUMN yerel_sira_no integer, ADD COLUMN senkron_zamani timestamptz;
CREATE UNIQUE INDEX gorsel_yerel_sira ON gorsel_kanit (dosya_ref, ceken_ref, yerel_sira_no) WHERE yerel_sira_no IS NOT NULL;

-- YG-134: numune devir zinciri; her el değiştirme ayrı satırdır, kayıt silinmez ve değiştirilmez.
CREATE TABLE numune_devri (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), numune_no text NOT NULL, dosya_ref uuid NOT NULL REFERENCES dosya (kimlik), numune_tanimi text NOT NULL, alindigi_bolge text,
  teslim_eden_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), teslim_alan text NOT NULL, amac text NOT NULL, onceki_ref uuid REFERENCES numune_devri (kimlik), aciklama text,
  devir_zamani timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX numune_devri_dosya ON numune_devri (dosya_ref, numune_no);
GRANT SELECT, INSERT ON numune_devri TO yatonet_uygulama;

-- YG-466: e-postası ve hesabı olmayan alıcıya onaylı belgenin kalıcı veri saklayıcıyla iletim kaydı.
CREATE TABLE kalici_saklayici_iletimi (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), kart_ref uuid NOT NULL UNIQUE REFERENCES is_karti (kimlik), onay_ref uuid, dosya_ref uuid REFERENCES dosya (kimlik),
  saklayici_turu text NOT NULL CHECK (saklayici_turu IN ('USB Bellek', 'CD/DVD', 'Hafıza Kartı', 'Basılı Belge', 'Diğer')), teslim_alan text NOT NULL, teslim_zamani timestamptz NOT NULL, aciklama text,
  kaydeden_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), kayit_zamani timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON kalici_saklayici_iletimi TO yatonet_uygulama;
