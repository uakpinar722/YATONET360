-- Kurumsal Çerçeve m.26.4: Ek-2 temsilcinin SMS kodlu onayıyla kabul edilir; onaya kadar önceki sürüm geçerlidir.
ALTER TABLE kurumsal_ek2 ADD COLUMN durum text NOT NULL DEFAULT 'Onay Bekliyor' CHECK (durum IN ('Onay Bekliyor', 'Yürürlükte', 'Reddedildi')), ADD COLUMN onay_ref uuid REFERENCES onay_talebi (kimlik);
GRANT UPDATE ON kurumsal_ek2 TO yatonet_uygulama;
