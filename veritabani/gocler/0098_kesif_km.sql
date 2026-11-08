-- KSF-1: keşif süresi firmaya gönderimle başladığı için mesafe keşif kaydında saklanır.
ALTER TABLE kesif ADD COLUMN IF NOT EXISTS km numeric(8,1);
