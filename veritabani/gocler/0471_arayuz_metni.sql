-- YG-1390, YG-1391: arayüz sabit metinleri çeviri kütüphanesi. İngilizce karşılık onaylanana kadar kullanılmaz (Türkçe gösterilir).
-- Onay Bilgi Teknolojileri ve Firma Yönetimi Direktöründe; hukuki işaretli metnin İngilizcesini CEO onaylar (YG-1391).
CREATE TABLE arayuz_metni (
  tr              text PRIMARY KEY,
  en_oneri        text,
  hukuki          boolean NOT NULL DEFAULT false,
  en_onayli       text,
  onaylayan_ref   text REFERENCES kullanici_hesabi (kimlik),
  onay_zamani     timestamptz,
  guncelleme_zamani timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON arayuz_metni TO yatonet_uygulama;
