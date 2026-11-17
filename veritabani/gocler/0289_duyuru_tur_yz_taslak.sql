-- YG-563: özel gün kutlamaları duyuru modülünden yönetilir.
ALTER TABLE duyuru ADD COLUMN tur text NOT NULL DEFAULT 'Genel' CHECK (tur IN ('Genel', 'Özel Gün'));
-- YG-732: yapay zekâ taslağı iç kayıttır; giden raporda gösterilmez.
ALTER TABLE teknik_rapor ADD COLUMN yz_taslagi text;
