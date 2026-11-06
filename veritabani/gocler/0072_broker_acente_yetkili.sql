-- YG-1031: sigorta brokeri, sigorta acentesi ve yat brokeri de Yat Yetkilisi kaydıyla, yetki belgesindeki işlem, limit ve süre içinde onaylar.
ALTER TABLE yat_yetkilisi_kaydi DROP CONSTRAINT IF EXISTS yat_yetkilisi_kaydi_rol_check;
ALTER TABLE yat_yetkilisi_kaydi ADD CONSTRAINT yat_yetkilisi_kaydi_rol_check CHECK (rol IN ('Yatın Kaptanı', 'Yat Sahibinin Yetkili Temsilcisi', 'Yat Yönetim Şirketi / İşletmeci', 'Sigorta Brokeri', 'Sigorta Acentesi', 'Yat Brokeri', 'Diğer'));
