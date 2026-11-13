-- YG-648: kalite planı bölümleri. Eski planlarda yeni alanlar boş kalır (geriye dönük doldurulmaz).
ALTER TABLE kalite_plani ADD COLUMN risk_seviyesi text CHECK (risk_seviyesi IN ('Düşük', 'Orta', 'Yüksek', 'Kritik')),
  ADD COLUMN teknik_kaynak text, ADD COLUMN sorumluluklar text, ADD COLUMN kaynaklar text, ADD COLUMN kontrol_duzeni text, ADD COLUMN kayit_teslim text, ADD COLUMN degisiklik_gerekcesi text;
ALTER TABLE kalite_plani DROP CONSTRAINT IF EXISTS kalite_plani_surum_check;
ALTER TABLE kalite_plani ADD CONSTRAINT kalite_plani_surum_check CHECK (surum >= 0);
