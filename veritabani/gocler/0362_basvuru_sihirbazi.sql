-- YG-1648 (A36): C-1 Çözüm Ortağı Başvurusu sihirbazı; vergi dairesi, beyan durumu ve başvuru kanalı (kötüye kullanım sınırı için başvuran adresi).
ALTER TABLE kurulus ADD COLUMN vergi_dairesi text, ADD COLUMN beyan_teyidi text CHECK (beyan_teyidi IN ('Teyit Bekliyor', 'Teyit Edildi')), ADD COLUMN basvuru_kanali text, ADD COLUMN basvuru_adresi text;
