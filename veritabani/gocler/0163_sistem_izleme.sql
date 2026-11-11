-- YG-778: istek ölçümü (dakika ve akış bazında; gövde tutulmaz) ve çalışma nabzı; 90 gün saklanır.
CREATE TABLE istek_olcumu (dakika timestamptz NOT NULL, akis text NOT NULL, adet integer NOT NULL, hata integer NOT NULL, toplam_ms bigint NOT NULL, azami_ms integer NOT NULL, PRIMARY KEY (dakika, akis));
CREATE TABLE calisma_nabzi (dakika timestamptz PRIMARY KEY);
GRANT SELECT, INSERT, UPDATE, DELETE ON istek_olcumu, calisma_nabzi TO yatonet_uygulama;
