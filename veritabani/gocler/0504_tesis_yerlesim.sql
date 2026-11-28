-- YG-348 (V-1139): tesis kaydında yerleşim türü ve rol türüne göre koşullu zorunlu alanlar (Alan Sözlüğü, Tesis ve Şube);
-- bölge ve hizmet kümesi il-ilçe eşleşmesinden türetilir; hassas güvenlik konumu genel kullanıcıya açılmaz.
ALTER TABLE firma_tesisi
  ADD COLUMN yerlesim_turu text CHECK (yerlesim_turu IN ('Merkez', 'Şube', 'Teknik Tesis', 'Depo/Sevk')),
  ADD COLUMN konum_turu text, ADD COLUMN mahalle text, ADD COLUMN bolge text, ADD COLUMN hizmet_kumesi text,
  ADD COLUMN kullanim_dayanagi text, ADD COLUMN tesis_sinifi text,
  ADD COLUMN gecici_saha boolean NOT NULL DEFAULT false, ADD COLUMN mobil_ekip_cikis_noktasi boolean NOT NULL DEFAULT false,
  ADD COLUMN kapali_alan_m2 numeric(10,1) CHECK (kapali_alan_m2 >= 0), ADD COLUMN acik_alan_m2 numeric(10,1) CHECK (acik_alan_m2 >= 0),
  ADD COLUMN konum_dogrulugu text, ADD COLUMN malik_isletmeci text, ADD COLUMN hassas_konum boolean NOT NULL DEFAULT false;
-- Mevcut kayıtlarda bölge ve hizmet kümesi il-ilçe eşleşmesinden (yoksa ilin varsayılanından) doldurulur.
UPDATE firma_tesisi t SET bolge = coalesce(e.bolge, v.bolge), hizmet_kumesi = coalesce(e.hizmet_kumesi, v.hizmet_kumesi)
FROM firma_tesisi x LEFT JOIN bolge_eslesme e ON lower(e.il) = lower(x.il) AND lower(e.ilce) = lower(x.ilce) LEFT JOIN il_varsayilan v ON lower(v.il) = lower(x.il)
WHERE x.kimlik = t.kimlik AND x.il IS NOT NULL;
