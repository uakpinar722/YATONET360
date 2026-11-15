-- YG-1816: firmanın son statü/aşama/risk kararı zamanı.
ALTER TABLE kurulus ADD COLUMN son_statu_karar_zamani timestamptz;
