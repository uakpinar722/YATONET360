-- YG-510: role göre bildirim kuralı. Tekrar sıklığı: aynı başlıklı bildirim bu süre içinde dış kanaldan yeniden gönderilmez (sistem içinde kalır).
-- Sessiz saat: bu aralıkta planlanan dış ileti aralık sonuna ertelenir. Birleştirme: gönderilmeyi bekleyen iletiye eklenir. Kritik bildirim etkilenmez.
CREATE TABLE bildirim_kurali (
  rol_ref text PRIMARY KEY REFERENCES rol (kimlik), tekrar_dakika integer CHECK (tekrar_dakika > 0),
  sessiz_baslangic time, sessiz_bitis time, birlestir boolean NOT NULL DEFAULT false,
  guncelleyen_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), guncelleme_zamani timestamptz NOT NULL DEFAULT now(),
  CHECK ((sessiz_baslangic IS NULL) = (sessiz_bitis IS NULL))
);
GRANT SELECT, INSERT, UPDATE ON bildirim_kurali TO yatonet_uygulama;
