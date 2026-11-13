-- YG-321: iş emrinin hariçleri, varsayımları ve bağımlılıkları iş emriyle birlikte tutulur.
ALTER TABLE is_emri ADD COLUMN haricler text, ADD COLUMN varsayimlar text, ADD COLUMN bagimliliklar text;
