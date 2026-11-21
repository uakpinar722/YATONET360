-- YG-220: yat sahibinin sistem erişimi yoksa teklif kararı ıslak imzalı taranmış belgeyle kaydedilir; kanal onay kaydında görünür.
ALTER TABLE fiyat_teklifi ADD COLUMN onay_kanali text CHECK (onay_kanali IN ('YATONET 360', 'Islak İmza')), ADD COLUMN islak_imza_belge_ref uuid REFERENCES belge (kimlik), ADD COLUMN islak_imza_gerekcesi text, ADD COLUMN islak_imza_kaydeden_ref text REFERENCES kullanici_hesabi (kimlik);
CREATE OR REPLACE VIEW onay_kaydi AS
  SELECT t.dosya_ref, 'Talimat'::text tur, t.alinma_zamani zaman, left(t.ozgun_metin, 200) konu, t.tur sonuc, t.gonderen onaylayan, t.kanal, 'talimat_kaydi'::text kaynak_tablo, t.kimlik::text kaynak_kimlik
    FROM talimat_kaydi t WHERE t.tur IN ('Talimat', 'Karar') AND (t.kaynak_yetkili OR t.kaynak_sonucu = 'Doğrulandı')
  UNION ALL
  SELECT c.dosya_ref, 'Teknik Onay', c.onay_zamani, 'Kapsam Cetveli ' || coalesce(c.cetvel_no, 'Sürüm ' || c.surum), 'Onaylandı', h.ad_soyad, 'YATONET 360', 'kapsam_cetveli', c.kimlik::text
    FROM kapsam_cetveli c LEFT JOIN kullanici_hesabi h ON h.kimlik = c.onaylayan_ref WHERE c.onay_zamani IS NOT NULL
  UNION ALL
  SELECT f.dosya_ref, 'Bedel Kabulü', f.karar_zamani, 'Fiyat Teklifi ' || f.teklif_no || ' Rev.' || f.surum_no, f.karar, f.teklif_muhatabi, coalesce(f.onay_kanali, 'YATONET 360'), 'fiyat_teklifi', f.kimlik::text
    FROM fiyat_teklifi f WHERE f.statu = 'Karar' AND f.karar_zamani IS NOT NULL AND f.teklif_muhatabi <> 'Sigorta Şirketi'
  UNION ALL
  SELECT s.dosya_ref, 'Bedel Kabulü', s.onay_tarihi, 'Sigorta Kararı · Fiyat Teklifi ' || f.teklif_no || ' Rev.' || f.surum_no, s.karar, s.onaylayan_yetkili, s.onay_kanali, 'sigorta_onayi', s.kimlik::text
    FROM sigorta_onayi s JOIN fiyat_teklifi f ON f.kimlik = s.teklif_ref
  UNION ALL
  SELECT p.dosya_ref, 'Değişiklik Onayı', coalesce(o.karar_zamani, p.olusturma_zamani), p.degisiklik_no || ' · ' || p.tur, p.durum, NULL, p.kanal, 'degisiklik_protokolu', p.kimlik::text
    FROM degisiklik_protokolu p LEFT JOIN onay_talebi o ON o.kimlik = p.onay_talebi_ref WHERE p.durum IN ('Onaylandı', 'Reddedildi')
  UNION ALL
  SELECT k.dosya_ref, 'Teslim Kabulü', k.teslim_zamani, 'Teslim', coalesce(k.karar, k.durum), k.teslim_alan, CASE WHEN k.islak_imzali_belge_ref IS NOT NULL THEN 'Islak İmza' ELSE 'YATONET 360' END, 'teslim_kaydi', k.kimlik::text
    FROM teslim_kaydi k WHERE k.durum LIKE 'Teslim Edildi%' AND k.teslim_zamani IS NOT NULL;
GRANT SELECT ON onay_kaydi TO yatonet_uygulama;
