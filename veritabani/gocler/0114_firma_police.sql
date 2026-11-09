-- YG-1471: firma sorumluluk poliçesi limiti ve gözetim-muhafaza tavsiyesi.
ALTER TABLE sicil_belgesi ADD COLUMN police_limit_eur numeric(14,2) CHECK (police_limit_eur > 0), ADD COLUMN gozetim_muhafaza boolean;
