-- İlk giriş: davet, hukuki metin sürümleri, aydınlatma, kullanım koşulları, rıza. KVKK-10, YG-1205…YG-1217.

CREATE TABLE davet (
  kimlik             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  olusturma_zamani   timestamptz NOT NULL DEFAULT now(),
  kullanici_ref      text NOT NULL REFERENCES kullanici_hesabi (kimlik),
  belirtec_ozeti     text NOT NULL UNIQUE,
  son_gecerlilik     timestamptz NOT NULL,
  kullanilma_zamani  timestamptz,
  olusturan          text REFERENCES kullanici_hesabi (kimlik)
);

CREATE TABLE hukuki_metin (
  kod         text NOT NULL,
  dil         text NOT NULL CHECK (dil IN ('tr', 'en')),
  surum       text NOT NULL,
  baslik      text NOT NULL,
  govde       jsonb NOT NULL,
  yukleme_zamani timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (kod, dil, surum)
);

CREATE TABLE aydinlatma_kaydi (
  kimlik            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ilgili_kisi_ref   text NOT NULL REFERENCES kullanici_hesabi (kimlik),
  ilgili_kisi_grubu text NOT NULL,
  aydinlatma_metni  text NOT NULL,
  metin_surumu      text NOT NULL,
  dil               text NOT NULL,
  sunum_kanali      text NOT NULL,
  sunum_zamani      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX aydinlatma_kisi ON aydinlatma_kaydi (ilgili_kisi_ref, aydinlatma_metni, metin_surumu);

CREATE TABLE kullanim_kosullari_kabulu (
  kimlik        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kullanici_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik),
  prt_surumu    text NOT NULL,
  dil           text NOT NULL,
  kabul_zamani  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX kosul_kisi ON kullanim_kosullari_kabulu (kullanici_ref, prt_surumu);

CREATE TABLE acik_riza (
  kimlik               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ilgili_kisi_ref      text NOT NULL REFERENCES kullanici_hesabi (kimlik),
  riza_turu            text NOT NULL,
  amac                 text,
  kanal                text,
  durum                text NOT NULL DEFAULT 'Verildi' CHECK (durum IN ('Verildi', 'Geri Alındı')),
  onay_zamani          timestamptz NOT NULL DEFAULT now(),
  kaynak               text NOT NULL,
  metin_surumu         text NOT NULL,
  varsayilan_isaretsiz boolean NOT NULL DEFAULT true CHECK (varsayilan_isaretsiz),
  geri_alma_zamani     timestamptz,
  geri_alma_kanali     text,
  iys_bildirim_zamani  timestamptz,
  gonderim_engeli      boolean NOT NULL DEFAULT false
);
CREATE INDEX riza_kisi ON acik_riza (ilgili_kisi_ref);

-- İsteğe bağlı izinler adımı bir kez sorulur; rıza verilmese de hesap kullanılır.
ALTER TABLE kullanici_hesabi ADD COLUMN izin_adimi_zamani timestamptz;

GRANT SELECT, INSERT, UPDATE ON davet, acik_riza TO yatonet_uygulama;
GRANT SELECT ON hukuki_metin TO yatonet_uygulama;
GRANT SELECT, INSERT ON aydinlatma_kaydi, kullanim_kosullari_kabulu TO yatonet_uygulama;
