-- YG-509: kullanıcı bildirimi gizleyebilir (silinmez, iz kalır).
ALTER TABLE bildirim ADD COLUMN gizlenme_zamani timestamptz;
