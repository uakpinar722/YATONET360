-- KDV-1: teklif tutarı proformayla aynı KDV kuralıyla; tevkifat ayrı tutulur.
ALTER TABLE fiyat_teklifi ADD COLUMN tevkifat_eur numeric(14,2) NOT NULL DEFAULT 0;
