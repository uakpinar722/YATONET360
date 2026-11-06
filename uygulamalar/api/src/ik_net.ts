const R2 = (x: number) => Math.round(Number((x * 100).toPrecision(12))) / 100;

/**
 * YG-978: kıdem tazminatından yalnız damga vergisi kesilir. İhbar tazminatından damga vergisine ek olarak gelir vergisi kesilir;
 * gelir vergisi çalışanın yıl içindeki kümülatif matrahına bağlı olduğundan sistemde hesaplanmaz, bordroda (muhasebe hizmeti) hesaplanır.
 * Damga vergisi oranı İK parametresidir (binde değer olarak girilir); girilmemişse net hesaplanmaz.
 */
export function tazminatNet(g: { kidemBrut: number | null; ihbarBrut: number; damgaBinde: number | null }) {
  if (g.damgaBinde === null) return null;
  const oran = g.damgaBinde / 1000;
  const kidemDamga = g.kidemBrut === null ? null : R2(g.kidemBrut * oran);
  const ihbarDamga = R2(g.ihbarBrut * oran);
  return {
    kidem: g.kidemBrut === null ? null : { brut: g.kidemBrut, damga: kidemDamga!, net: R2(g.kidemBrut - kidemDamga!) },
    ihbar: { brut: g.ihbarBrut, damga: ihbarDamga, gelirVergisi: 'Bordroda hesaplanır', netDamgaSonrasi: R2(g.ihbarBrut - ihbarDamga) },
  };
}
