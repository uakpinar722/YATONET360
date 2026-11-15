-- YG-376: kara taşıması, denize indirme sonrası su alma kontrolü, yeni hasar açıklaması.
ALTER TABLE kaldirma_tasima DROP CONSTRAINT kaldirma_tasima_tur_check;
ALTER TABLE kaldirma_tasima ADD CONSTRAINT kaldirma_tasima_tur_check CHECK (tur IN ('Kaldırma', 'Taşıma', 'Tesis Değişikliği', 'Kara Taşıması', 'Denize İndirme'));
ALTER TABLE kaldirma_tasima ADD COLUMN guzergah text, ADD COLUMN su_alma_kontrolu text CHECK (su_alma_kontrolu IN ('Su Alma Yok', 'Su Alma Var')), ADD COLUMN yeni_hasar_aciklama text;
