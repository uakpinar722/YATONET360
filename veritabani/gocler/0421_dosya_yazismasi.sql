-- YG-1663, YG-1666: dosyaya bağlı yazışma. Başlık dış taraf kullanıcısıdır; metin değiştirilemez ve silinemez (yalnız öncelik, yanıt ve okunma alanları güncellenir).
CREATE TABLE dosya_yazismasi (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), dosya_ref uuid NOT NULL REFERENCES dosya (kimlik), dis_taraf_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik),
  gonderen_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), lgm boolean NOT NULL, metin text NOT NULL CHECK (length(metin) BETWEEN 1 AND 4000),
  oncelik text NOT NULL CHECK (oncelik IN ('Kritik', 'Yüksek', 'Normal', 'Planlı')), tehlike boolean NOT NULL DEFAULT false, bekleyen_oncelik text CHECK (bekleyen_oncelik IN ('Kritik', 'Yüksek', 'Normal', 'Planlı')),
  yanit_son timestamptz, yanitlandi_zamani timestamptz, okunma_zamani timestamptz, zaman timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX dosya_yazismasi_baslik ON dosya_yazismasi (dosya_ref, dis_taraf_ref, zaman);
GRANT SELECT, INSERT ON dosya_yazismasi TO yatonet_uygulama;
GRANT UPDATE (oncelik, bekleyen_oncelik, yanitlandi_zamani, okunma_zamani) ON dosya_yazismasi TO yatonet_uygulama;
