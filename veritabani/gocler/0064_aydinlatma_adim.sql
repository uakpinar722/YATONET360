-- YG-1210: aydınlatma kaydında adım ve işlem amacı.
ALTER TABLE aydinlatma_kaydi ADD COLUMN onay_adimi text, ADD COLUMN islem_amaci text;
