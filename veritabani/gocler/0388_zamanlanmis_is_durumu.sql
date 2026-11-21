-- YG-1316: zamanlanmış iş grupları tekil çalışır; her turun başlangıç, bitiş, süre, hata ve çakışma bilgisi tutulur. Gecikme veya çakışmada
-- Sistem Yöneticisine, işin etkilediği bildirim, rapor ve görevleri yazan uyarı açılır.
CREATE TABLE zamanlanmis_is_durumu (
  ad text PRIMARY KEY, etki text NOT NULL, periyot_sn integer NOT NULL CHECK (periyot_sn > 0),
  son_baslangic timestamptz, son_bitis timestamptz, son_sure_ms integer, son_hata text, hata_sayisi integer NOT NULL DEFAULT 0,
  cakisma_sayisi integer NOT NULL DEFAULT 0, son_cakisma timestamptz, guncelleme_zamani timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON zamanlanmis_is_durumu TO yatonet_uygulama;
