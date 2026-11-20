-- YG-1655 (A38): "Dönem Kartlarını Kaydet" — dönemin sistemce hesaplanan performans kartlarının Firma Yönetimi Müdür Yardımcısınca kaydı (ayrı onay adımı yok).
CREATE TABLE firma_donem_karti_kaydi (
  donem_sonu date PRIMARY KEY, firma_sayisi integer NOT NULL, kademeli_dusus integer NOT NULL, kaydeden_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), zaman timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON firma_donem_karti_kaydi TO yatonet_uygulama;
