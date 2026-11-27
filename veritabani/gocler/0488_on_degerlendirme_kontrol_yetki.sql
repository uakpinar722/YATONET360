-- YG-038 (V-1116): rapor içeriği değiştirilemez kalır; uygulama yalnız kalite kontrolü sütunlarını güncelleyebilir.
GRANT UPDATE (kalite_kontrol_sonucu, kalite_kontrol_notu, kalite_kontrol_ref, kalite_kontrol_zamani, onayli) ON on_degerlendirme TO yatonet_uygulama;
