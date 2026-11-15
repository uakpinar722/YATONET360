-- YG-415: açık iş sorumlusu; koşullu kabulde etki değerlendirmesi ve onayı.
ALTER TABLE acik_is_kalemi ADD COLUMN sorumlu text;
ALTER TABLE kabul_kaydi ADD COLUMN etki_degerlendirmesi jsonb, ADD COLUMN etki_onayi text CHECK (etki_onayi IN ('Bekliyor', 'Onaylandı', 'Reddedildi'));
