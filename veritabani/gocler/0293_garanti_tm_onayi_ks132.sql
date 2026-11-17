-- YG-1416: 5.000,00 EUR üstü düzeltme maliyetli garanti kapsam kararı Teknik Müdür onayına gider; karar onaylanınca yazılır.
ALTER TABLE garanti_sikayet ADD COLUMN onay_bekleyen_karar text, ADD COLUMN onay_bekleyen_maliyet numeric(14,2);
-- YG-1703: birlikte yazılmaz kuralı KS-132 (veri dosyasıyla aynı).
INSERT INTO kartela_birlikte_yazilmaz SELECT 'KS-132', ARRAY['STABILITE-01.05.01-01', 'STABILITE-01.01.04-01', 'STABILITE-01.01.05-01'], 'GMO tarifeli stabilite raporu (STABILITE-01.05.01-01) ile saatle stabilite değerlendirmesi (STABILITE-01.01.04-01 veya STABILITE-01.01.05-01) aynı teklife birlikte yazılırsa aynı iş iki kez fiyatlanır (YG-1703).' WHERE NOT EXISTS (SELECT 1 FROM kartela_birlikte_yazilmaz WHERE grup = 'KS-132');
