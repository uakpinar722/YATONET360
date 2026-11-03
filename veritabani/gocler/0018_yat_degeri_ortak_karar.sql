-- K-240: yat değeri otomatik hesaplanmaz; her hasar dosyasında atanmış Operasyon Yöneticisi ve Teknik Yönetici ortak karar verir. yat.yat_degeri_* sütunları kullanılmaz.
CREATE TABLE dosya_yat_degeri (
  dosya_ref uuid PRIMARY KEY REFERENCES dosya (kimlik), durum text NOT NULL DEFAULT 'Bekliyor' CHECK (durum IN ('Bekliyor', 'Uyuşmazlık', 'Kesin')), deger_eur numeric(14,2), kesinlesme_zamani timestamptz,
  ek_police_durumu text CHECK (ek_police_durumu IN ('Gerekli değil', 'Gerekli – bekleniyor', 'Sağlandı')), ek_police_belge_ref uuid REFERENCES belge (kimlik), guncelleme_zamani timestamptz NOT NULL DEFAULT now(),
  CHECK ((durum = 'Kesin') = (deger_eur IS NOT NULL))
);
CREATE TABLE dosya_yat_degeri_gorusu (
  dosya_ref uuid NOT NULL REFERENCES dosya (kimlik), rol text NOT NULL CHECK (rol IN ('Operasyon Yöneticisi', 'Teknik Yönetici')), kullanici_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), deger_eur numeric(14,2) NOT NULL CHECK (deger_eur > 0), dayanak text NOT NULL CHECK (length(trim(dayanak)) > 0), zaman timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (dosya_ref, rol)
);
GRANT SELECT, INSERT, UPDATE ON dosya_yat_degeri, dosya_yat_degeri_gorusu TO yatonet_uygulama;
