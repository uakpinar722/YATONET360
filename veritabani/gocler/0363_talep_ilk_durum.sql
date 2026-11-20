-- YG-002: talebin kayıt anındaki ilk durumu (iş akışı durumu değil, sınıflandırmadır; durum sözlüğüne girmez) ve kayıtta eksik kalan bilgiler.
ALTER TABLE talep ADD COLUMN ilk_siniflandirma text CHECK (ilk_siniflandirma IN ('Yeni', 'Acil', 'Eksik', 'İncelemede')), ADD COLUMN eksik_bilgiler text[] NOT NULL DEFAULT '{}';
