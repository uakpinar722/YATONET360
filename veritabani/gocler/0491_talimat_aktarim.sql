-- YG-568 (V-1119): e-posta, telefon ve kişisel kanaldan gelen bilginin dosyaya aktarım süresi (Kritik/Yüksek: ilk yanıt süresi, Normal/Planlı: 24 saat).
ALTER TABLE talimat_kaydi ADD COLUMN aktarim_siniri_saat numeric, ADD COLUMN gec_aktarim boolean NOT NULL DEFAULT false;
