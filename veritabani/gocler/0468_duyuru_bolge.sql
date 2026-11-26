-- YG-560: duyuru bölgeye göre hedeflenebilir; kullanıcının bölgesi bağlı olduğu kuruluşun (Çözüm Ortağı, tedarikçi, tesis) sicildeki bölgesidir. Bölge seçilirse kuruluşa bağlı olmayan kullanıcı hedefte sayılmaz.
ALTER TABLE duyuru ADD COLUMN hedef_bolgeler text[] NOT NULL DEFAULT '{}';
CREATE OR REPLACE FUNCTION duyuru_hedefte(d uuid, k text) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM duyuru x JOIN kullanici_hesabi h ON h.kimlik = k WHERE x.kimlik = d
    AND (x.kapsam = 'Tümü' OR (x.kapsam = 'LGM') = (h.kullanici_grubu = 'LGM İç Rolü'))
    AND (cardinality(x.hedef_gruplar) = 0 OR h.kullanici_grubu = ANY (x.hedef_gruplar))
    AND (cardinality(x.hedef_roller) = 0 OR EXISTS (SELECT 1 FROM rol_atamasi a WHERE a.kullanici_ref = k AND a.atama_durumu = 'Aktif' AND a.rol_ref = ANY (x.hedef_roller)))
    AND (cardinality(x.hedef_birimler) = 0 OR EXISTS (SELECT 1 FROM rol_atamasi a JOIN rol r ON r.kimlik = a.rol_ref WHERE a.kullanici_ref = k AND a.atama_durumu = 'Aktif' AND r.rol_sahibi_birim = ANY (x.hedef_birimler)))
    AND (cardinality(x.hedef_bolgeler) = 0 OR EXISTS (SELECT 1 FROM kurulus_kullanici u JOIN kurulus o ON o.kimlik = u.kurulus_ref WHERE u.kullanici_ref = k AND o.bolge = ANY (x.hedef_bolgeler))))
$$;
