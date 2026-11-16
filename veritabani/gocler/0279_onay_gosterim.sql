-- YG-467: onay ekranının ilk gösterildiği an.
ALTER TABLE onay_talebi ADD COLUMN gosterim_zamani timestamptz;
