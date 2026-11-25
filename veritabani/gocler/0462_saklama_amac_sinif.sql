-- YG-1224: saklama planında iş amacı (KVKK-06 VERBİS işleme amaçları) ve bilgi sınıfı; süre ve imha KVKK-07'den.
ALTER TABLE saklama_plani ADD COLUMN is_amaci text, ADD COLUMN bilgi_sinifi text CHECK (bilgi_sinifi IN ('Kamuya Açık', 'Kurumsal', 'Gizli', 'Kritik'));
UPDATE saklama_plani p SET is_amaci = v.a, bilgi_sinifi = v.s FROM (VALUES
  ('LOG-2', 'Bilgi güvenliği süreçlerinin yürütülmesi', 'Gizli'),
  ('OPS-5', 'Mal ve hizmet satış süreçlerinin yürütülmesi', 'Gizli'),
  ('ILS-5', 'Tedarik zinciri yönetimi süreçlerinin yürütülmesi', 'Gizli'),
  ('MAL-10', 'Finans ve muhasebe işlerinin yürütülmesi', 'Gizli'),
  ('SOZ-10', 'Sözleşme süreçlerinin yürütülmesi', 'Gizli'),
  ('OZL-10', 'Ücret politikasının yürütülmesi; iş sağlığı ve güvenliği faaliyetlerinin yürütülmesi', 'Kritik'),
  ('ADY-6A', 'Çalışan adaylarının seçme ve yerleştirme süreçlerinin yürütülmesi', 'Gizli'),
  ('TIC-10', 'Mal ve hizmet satış süreçlerinin yürütülmesi', 'Gizli'),
  ('RIZA', 'Pazarlama analiz çalışmaları ile reklam, kampanya ve promosyon süreçlerinin yürütülmesi (açık rızaya bağlı)', 'Gizli'),
  ('IMH-3', 'Hukuk işlerinin takibi ve yürütülmesi', 'Kurumsal'),
  ('KON-1', 'Acil durum yönetimi süreçlerinin yürütülmesi (acil durum bildiriminde konum)', 'Gizli'),
  ('SIC-OZ', 'Tedarik zinciri yönetimi süreçlerinin yürütülmesi', 'Kurumsal'),
  ('ADY-1', 'Tedarik zinciri yönetimi süreçlerinin yürütülmesi', 'Kurumsal'),
  ('HSP', 'Bilgi güvenliği süreçlerinin yürütülmesi', 'Gizli'),
  ('ERS-2', 'Bilgi güvenliği süreçlerinin yürütülmesi', 'Gizli'),
  ('DST-5', 'Talep ve şikâyetlerin takibi', 'Gizli'),
  ('IHL-10', 'Hukuk işlerinin takibi ve yürütülmesi', 'Kritik')
) v(k, a, s) WHERE p.kod = v.k;
