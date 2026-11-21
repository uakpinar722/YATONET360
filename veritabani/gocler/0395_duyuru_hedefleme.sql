-- YG-560: duyuru kapsamın içinde kullanıcı grubu, rol ve birime göre daraltılır (boş liste: sınır yok); yayın başlangıcı, ek ve İngilizce metin.
ALTER TABLE duyuru ADD COLUMN hedef_gruplar text[] NOT NULL DEFAULT '{}', ADD COLUMN hedef_roller text[] NOT NULL DEFAULT '{}', ADD COLUMN hedef_birimler text[] NOT NULL DEFAULT '{}',
  ADD COLUMN yayin_baslangic timestamptz, ADD COLUMN baslik_en text, ADD COLUMN govde_en text, ADD COLUMN ek_belge_ref uuid REFERENCES belge (kimlik);
CREATE FUNCTION duyuru_hedefte(d uuid, k text) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM duyuru x JOIN kullanici_hesabi h ON h.kimlik = k WHERE x.kimlik = d
    AND (x.kapsam = 'Tümü' OR (x.kapsam = 'LGM') = (h.kullanici_grubu = 'LGM İç Rolü'))
    AND (cardinality(x.hedef_gruplar) = 0 OR h.kullanici_grubu = ANY (x.hedef_gruplar))
    AND (cardinality(x.hedef_roller) = 0 OR EXISTS (SELECT 1 FROM rol_atamasi a WHERE a.kullanici_ref = k AND a.atama_durumu = 'Aktif' AND a.rol_ref = ANY (x.hedef_roller)))
    AND (cardinality(x.hedef_birimler) = 0 OR EXISTS (SELECT 1 FROM rol_atamasi a JOIN rol r ON r.kimlik = a.rol_ref WHERE a.kullanici_ref = k AND a.atama_durumu = 'Aktif' AND r.rol_sahibi_birim = ANY (x.hedef_birimler))))
$$;
GRANT EXECUTE ON FUNCTION duyuru_hedefte(uuid, text) TO yatonet_uygulama;
