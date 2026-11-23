-- YG-104: tedbirli yatta can/çevre/batma riskiyle onaysız acil taşıma.
ALTER TABLE kaldirma_tasima ADD COLUMN acil_istisna text CHECK (acil_istisna IN ('Can', 'Çevre', 'Batma'));
