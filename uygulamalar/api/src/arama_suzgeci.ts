import type { FastifyInstance, RouteOptions } from 'fastify';

/**
 * YG-1162: arama ve otomatik tamamlama yolları ile her birinin kaynak erişim süzgeci. Yetkisiz kayıt başlık, etiket, özet
 * veya öneri olarak dönmez. Bu listede olmayan bir arama yolu eklenirse sunucu açılmaz.
 */
export const ARAMA_SUZGECI: Record<string, string> = {
  '/ara': 'LGM personeli; her dosya dosyaErisimi ile süzülür, firma sonuçları firma.kayit izniyle',
  '/yat/ara': 'ihbar.kaydet izni',
  '/taraf/ara': 'ihbar.kaydet izni; TCKN maskeli',
  '/yat/marka': 'Genel marka kataloğu; kayıt bilgisi içermez',
  '/yat/model': 'Genel model kataloğu; teknik ayrıntı yalnız LGM personeline',
  '/birlestirme/ara': 'Mükerrer kayıt birleştirme yetkisi',
  '/portal/ara': 'Yalnız kullanıcının taraf olduğu dosyalar',
  '/sigorta/ara': 'Yalnız kullanıcının şirketinin veya kendisinin dosyaları',
  '/kartela/ara': 'İşlem kataloğu; fiyat içermez',
  '/firma-portal/ara': 'Yalnız kullanıcının kurumuna verilen iş emirleri',
  '/tedarikci-portal/ara': 'Yalnız kullanıcının kurumuna verilen siparişler',
  '/denetim/arama': 'denetim_izi.goruntule izni',
  '/kvkk-basvuru/:id/arama': 'KVKK başvurusunu yürüten yetkili',
};

export const aramaYoluMu = (url: string) => /\/(ara|arama)$/.test(url) || /^\/yat\/(marka|model)$/.test(url);

export function aramaSuzgeciKancasi(s: FastifyInstance) {
  s.addHook('onRoute', (r: RouteOptions) => {
    const u = (r.url ?? '').replace(/^\/api/, '');
    if (aramaYoluMu(u) && !ARAMA_SUZGECI[u]) throw new Error(`Arama yolu erişim süzgeci tanımlanmadan eklenemez: ${u}`);
  });
}
