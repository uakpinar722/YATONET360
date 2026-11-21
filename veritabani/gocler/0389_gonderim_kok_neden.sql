-- YG-1309: başarısız gönderim kök neden sınıfıyla tutulur ve olay anahtarındaki kayıttan dosyasına bağlanır; operatörün düzeltip yeniden
-- çalıştırması kullanıcı, zaman, eski ve yeni veri ve gerekçeyle kaydedilir. Hatalı ileti sessizce atılmaz.
ALTER TABLE gonderim ADD COLUMN kok_neden text CHECK (kok_neden IN ('Geçersiz veya engelli hedef', 'Sağlayıcı veya bağlantı hatası', 'Yanlış iletişim bilgisi', 'Diğer'));
UPDATE gonderim SET kok_neden = CASE WHEN son_hata LIKE 'Kalıcı hata:%' THEN 'Geçersiz veya engelli hedef' ELSE 'Sağlayıcı veya bağlantı hatası' END WHERE durum = 'Başarısız';
CREATE TABLE gonderim_yeniden_calistirma (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), gonderim_ref uuid NOT NULL REFERENCES gonderim (kimlik),
  yapan_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), zaman timestamptz NOT NULL DEFAULT now(),
  eski_hedef text NOT NULL, yeni_hedef text NOT NULL, eski_hata text, kok_neden text NOT NULL, gerekce text NOT NULL CHECK (length(btrim(gerekce)) > 0),
  bilgi_sinifi text NOT NULL DEFAULT 'Gizli' CHECK (bilgi_sinifi IN ('Kurumsal', 'Gizli', 'Kritik'))
);
CREATE INDEX gonderim_yeniden_calistirma_g ON gonderim_yeniden_calistirma (gonderim_ref);
-- Olay anahtarındaki ilk kimlikten dosya bulunur (dosya, talep, teklif, onay talebi, iş emri, teslim, fatura).
CREATE FUNCTION gonderim_dosyasi(anahtar text) RETURNS uuid LANGUAGE sql STABLE AS $$
  WITH k AS (SELECT (regexp_match(anahtar, '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'))[1]::uuid id)
  SELECT coalesce((SELECT d.kimlik FROM dosya d, k WHERE d.kimlik = k.id), (SELECT d.kimlik FROM dosya d, k WHERE d.talep_ref = k.id),
    (SELECT x.dosya_ref FROM fiyat_teklifi x, k WHERE x.kimlik = k.id), (SELECT x.dosya_ref FROM onay_talebi x, k WHERE x.kimlik = k.id),
    (SELECT x.dosya_ref FROM is_emri x, k WHERE x.kimlik = k.id), (SELECT x.dosya_ref FROM teslim_kaydi x, k WHERE x.kimlik = k.id),
    (SELECT x.dosya_ref FROM musteri_faturasi x, k WHERE x.kimlik = k.id))
$$;
GRANT SELECT, INSERT ON gonderim_yeniden_calistirma TO yatonet_uygulama;
GRANT EXECUTE ON FUNCTION gonderim_dosyasi(text) TO yatonet_uygulama;
