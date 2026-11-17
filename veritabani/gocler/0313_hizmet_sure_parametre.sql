-- YG-1604: hizmet süreleri iç performans ölçütüdür; parametre olarak tutulur (T&O Direktörü önerir, GMY görüş, CEO onay). Başlangıç değerleri koddaki mevcut süreler; Teklif süresi teklif_saat_* parametrelerindedir.
INSERT INTO sistem_parametresi (kod, deger, aciklama) VALUES
  ('hizmet_ilk_yanit_kritik', 0.5, 'Hizmet süresi (saat): İlk Yanıt · Kritik'),
  ('hizmet_ilk_yanit_yuksek', 2, 'Hizmet süresi (saat): İlk Yanıt · Yüksek'),
  ('hizmet_ilk_yanit_normal', 4, 'Hizmet süresi (saat): İlk Yanıt · Normal'),
  ('hizmet_ilk_yanit_planli', 8, 'Hizmet süresi (saat): İlk Yanıt · Planlı'),
  ('hizmet_tu_atama_kritik', 1, 'Hizmet süresi (saat): Teknik Uzman Ataması · Kritik'),
  ('hizmet_tu_atama_yuksek', 4, 'Hizmet süresi (saat): Teknik Uzman Ataması · Yüksek'),
  ('hizmet_tu_atama_normal', 24, 'Hizmet süresi (saat): Teknik Uzman Ataması · Normal'),
  ('hizmet_tu_atama_planli', 48, 'Hizmet süresi (saat): Teknik Uzman Ataması · Planlı'),
  ('hizmet_randevu_yuksek', 24, 'Hizmet süresi (saat): Randevu İletişimi · Yüksek'),
  ('hizmet_randevu_normal', 72, 'Hizmet süresi (saat): Randevu İletişimi · Normal'),
  ('hizmet_randevu_planli', 120, 'Hizmet süresi (saat): Randevu İletişimi · Planlı'),
  ('hizmet_kesif_yuksek', 48, 'Hizmet süresi (saat): Keşif · Yüksek'),
  ('hizmet_kesif_normal', 72, 'Hizmet süresi (saat): Keşif · Normal'),
  ('hizmet_kesif_planli', 120, 'Hizmet süresi (saat): Keşif · Planlı'),
  ('hizmet_sahaya_ulasma_kritik', 4, 'Hizmet süresi (saat): Sahaya Ulaşma · Kritik'),
  ('hizmet_kesiften_teklife_yuksek', 96, 'Hizmet süresi (saat): Keşiften Teklife · Yüksek'),
  ('hizmet_kesiften_teklife_normal', 144, 'Hizmet süresi (saat): Keşiften Teklife · Normal'),
  ('hizmet_kesiften_teklife_planli', 240, 'Hizmet süresi (saat): Keşiften Teklife · Planlı')
ON CONFLICT (kod) DO NOTHING;
