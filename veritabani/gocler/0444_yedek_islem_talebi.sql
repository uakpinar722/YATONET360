-- YG-1277: yedek indirme, silme, saklama süresi değişikliği ve geri yükleme ayrıcalıklı onayla yapılır.
CREATE TABLE yedek_islem_talebi (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  yedek_ref uuid NOT NULL REFERENCES yedek_kaydi(kimlik),
  islem text NOT NULL CHECK (islem IN ('İndirme', 'Silme', 'Saklama Süresi Değişikliği', 'Geri Yükleme')),
  gerekce text NOT NULL,
  yeni_saklama_gun integer CHECK (yeni_saklama_gun > 0),
  talep_eden_ref text NOT NULL REFERENCES kullanici_hesabi(kimlik),
  durum text NOT NULL DEFAULT 'Onay Bekliyor' CHECK (durum IN ('Onay Bekliyor', 'Onaylandı', 'Reddedildi')),
  karar_zamani timestamptz,
  olusturma_zamani timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON yedek_islem_talebi TO yatonet_uygulama;
