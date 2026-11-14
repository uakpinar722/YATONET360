-- YG-028: Türkiye dışındaki yat talebinin CEO istisna onayı.
ALTER TABLE dosya ADD COLUMN yurt_disi_istisna text CHECK (yurt_disi_istisna IN ('Bekliyor', 'Onaylandı', 'Reddedildi'));
