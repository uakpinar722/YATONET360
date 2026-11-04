// YG-487: tek kod tabanı (iOS, Android). Ekranlar web uygulamasından gelir; çevrimdışı kuyruk, güvenli saklama, bildirim ve izinler yereldedir.
import * as Crypto from 'expo-crypto';
import * as Location from 'expo-location';
import * as Network from 'expo-network';
import * as Notifications from 'expo-notifications';
import { useEffect, useRef, useState } from 'react';
import { Alert, Platform, SafeAreaView, StatusBar, Text, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { CevrimdisiKuyruk, type Gonderici } from './src/cevrimdisi';
import { sifreliDepoAc } from './src/depo';

const WEB = process.env.EXPO_PUBLIC_YATONET_WEB ?? '';
/** Web sayfası oturum çereziyle eşitleme ister; sonuç React Native'e döner. */
const gonderJs = (id: string, g: unknown) => `fetch('/api/mobil/esitle',{method:'POST',credentials:'include',headers:{'content-type':'application/json','x-yatonet':'1'},body:${JSON.stringify(JSON.stringify({ kayitlar: g }))}}).then(r=>r.json().then(j=>({ok:r.ok,j}))).then(s=>window.ReactNativeWebView.postMessage(JSON.stringify({tur:'esitleme',id,...s}))).catch(()=>window.ReactNativeWebView.postMessage(JSON.stringify({tur:'esitleme',id,ok:false})));true;`.replace(/\bid\b(?=,\.\.\.s|,ok)/g, `id:'${id}'`);

export default function App() {
  const web = useRef<WebView>(null); const kuyruk = useRef<CevrimdisiKuyruk | null>(null); const bekleyen = useRef(new Map<string, (x: { ok: boolean; j?: { sonuc?: never } }) => void>());
  const [cevrimici, setCevrimici] = useState(true); const [sayi, setSayi] = useState(0);

  useEffect(() => {
    void (async () => {
      const gonder: Gonderici = (kayitlar) => new Promise((coz, red) => {
        const id = Crypto.randomUUID(); bekleyen.current.set(id, (x) => (x.ok && x.j?.sonuc ? coz(x.j.sonuc) : red(new Error('bağlantı'))));
        web.current?.injectJavaScript(gonderJs(id, kayitlar));
      });
      kuyruk.current = new CevrimdisiKuyruk(await sifreliDepoAc(), gonder, () => Crypto.randomUUID());
      setSayi(await kuyruk.current.bekleyenSayisi());
    })();
    const t = setInterval(() => { void (async () => {
      const n = await Network.getNetworkStateAsync(); const acik = Boolean(n.isInternetReachable); setCevrimici(acik);
      if (!acik || !kuyruk.current) return;
      await kuyruk.current.esitle(); setSayi(await kuyruk.current.bekleyenSayisi());
      const s = await kuyruk.current.sorunlular();
      const ilk = s[0];
      if (ilk) { Alert.alert('Eşitleme Uyarısı', ilk.hata ?? 'Kaydınız işlenemedi.'); await kuyruk.current.vazgec(ilk.kimlik); }
    })(); }, 15_000);
    return () => clearInterval(t);
  }, []);

  const mesaj = async (e: WebViewMessageEvent) => {
    const m = JSON.parse(e.nativeEvent.data) as { tur: string; id?: string; ok?: boolean; j?: never; yol?: string; govde?: unknown; temelZaman?: string; dosya?: string };
    if (m.tur === 'esitleme' && m.id) { bekleyen.current.get(m.id)?.({ ok: Boolean(m.ok), j: m.j }); bekleyen.current.delete(m.id); }
    if (m.tur === 'kuyruk' && m.yol && kuyruk.current) { await kuyruk.current.ekle(m.yol, m.govde, m.temelZaman); setSayi(await kuyruk.current.bekleyenSayisi()); }
    if (m.tur === 'bildirim-kaydi') { // YG-498
      const izin = await Notifications.requestPermissionsAsync(); if (!izin.granted) return;
      const b = (await Notifications.getDevicePushTokenAsync()).data as string;
      web.current?.injectJavaScript(`fetch('/api/mobil/cihaz',{method:'POST',credentials:'include',headers:{'content-type':'application/json','x-yatonet':'1'},body:${JSON.stringify(JSON.stringify({ platform: Platform.OS === 'ios' ? 'iOS' : 'Android', belirtec: b }))}});true;`);
    }
    if (m.tur === 'konum' && m.dosya) { // YG-500: izin isteği web tarafında aydınlatmayla gösterildikten sonra gelir.
      const izin = await Location.requestForegroundPermissionsAsync(); if (!izin.granted) return;
      const k = await Location.getCurrentPositionAsync({}); web.current?.injectJavaScript(`fetch('/api/mobil/saha-konum',{method:'POST',credentials:'include',headers:{'content-type':'application/json','x-yatonet':'1'},body:${JSON.stringify(JSON.stringify({ dosya: m.dosya, enlem: k.coords.latitude, boylam: k.coords.longitude }))}});true;`);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1 }}>
      <StatusBar barStyle="dark-content" />
      {(!cevrimici || sayi > 0) && <View style={{ padding: 8, backgroundColor: '#fff3cd' }}><Text style={{ textAlign: 'center' }}>{cevrimici ? `Eşitleniyor: ${sayi} kayıt` : `Çevrimdışı: ${sayi} kayıt bekliyor`}</Text></View>}
      <WebView ref={web} source={{ uri: WEB }} sharedCookiesEnabled domStorageEnabled onMessage={(e) => void mesaj(e)} />
    </SafeAreaView>
  );
}
