-- YG-536: görev veya onay türüne göre eşik. Onay süresi (dk), uyarının süreden kaç dakika önce gideceği ve görevde sürenin dolmasından kaç saat
-- sonra karar merciine eskalasyon yapılacağı. Tanımsız alan için öncelik parametresi (onay_sure_dk_*) ve 24 saat geçerlidir.
CREATE TABLE gorev_turu_esigi (
  tur text PRIMARY KEY CHECK (length(btrim(tur)) > 0), onay_sure_dk integer CHECK (onay_sure_dk > 0), uyari_once_dk integer CHECK (uyari_once_dk >= 0),
  eskalasyon_saat integer CHECK (eskalasyon_saat > 0), gerekce text NOT NULL, guncelleyen_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), guncelleme_zamani timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON gorev_turu_esigi TO yatonet_uygulama;
