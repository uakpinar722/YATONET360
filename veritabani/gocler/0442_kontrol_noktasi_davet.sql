-- YG-329: tanıklık/bekletme noktası davetlileri ve davet kanalları.
ALTER TABLE kontrol_noktasi ADD COLUMN davet_edilenler text, ADD COLUMN davet_kanali text[] NOT NULL DEFAULT '{}';
