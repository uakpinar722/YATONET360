// YG-490: sürüm kontrolü ve zorunlu güncelleme engeli. YG-497, YG-505: 15 dakika hareketsizlikte kilit; biyometrik doğrulama veya cihaz PIN'i ile açılır.
import Constants from 'expo-constants';
import * as LocalAuthentication from 'expo-local-authentication';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { AppState, Linking, Platform, Pressable, Text, View } from 'react-native';

export const KILIT_MS = 15 * 60_000;
const LACI = '#162442';

/** 1.2.3 biçimindeki sürümleri karşılaştırır (a < b → negatif). */
export function surumKarsilastir(a: string, b: string): number {
  const x = a.split('.').map(Number); const y = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0);
  return 0;
}

type Surum = { enAz: string; guncel: string; magaza: string | null };

/** Uygulama sürümü en düşük sürümün altındaysa kullanım engellenir; daha yeni sürüm varsa uyarı gösterilir. Sunucuya ulaşılamazsa engel konmaz (çevrimdışı kullanım sürer). */
export function SurumKontrolu({ web, children }: { web: string; children: ReactNode }) {
  const [s, setS] = useState<Surum | null>(null);
  const bu = Constants.expoConfig?.version ?? '0.0.0';
  useEffect(() => { if (web) void fetch(`${web}/api/mobil/surum?platform=${Platform.OS}`).then((r) => (r.ok ? r.json() : null)).then(setS).catch(() => setS(null)); }, [web]);
  if (s && surumKarsilastir(bu, s.enAz) < 0) return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <Text style={{ fontSize: 20, color: LACI, marginBottom: 12, textAlign: 'center' }}>Güncelleme Gerekli</Text>
      <Text style={{ textAlign: 'center', marginBottom: 20 }}>Kullandığınız sürüm ({bu}) artık desteklenmemektedir. Devam etmek için uygulamayı {s.guncel} sürümüne güncelleyiniz.</Text>
      {s.magaza && <Pressable onPress={() => void Linking.openURL(s.magaza!)} style={{ backgroundColor: LACI, padding: 14, borderRadius: 8 }}><Text style={{ color: '#fff' }}>Güncelle</Text></Pressable>}
    </View>
  );
  return <>{s && surumKarsilastir(bu, s.guncel) < 0 && <View style={{ padding: 8, backgroundColor: '#e8eef8' }}><Text style={{ textAlign: 'center' }}>Yeni sürüm ({s.guncel}) yayımlanmıştır; güncellemenizi rica ederiz.</Text></View>}{children}</>;
}

/** 15 dakika dokunma olmazsa veya uygulama 15 dakikadan uzun arka planda kalırsa ekran kilitlenir; açılış biyometrik ya da cihaz PIN'iyledir. */
export function Kilit({ children }: { children: ReactNode }) {
  const son = useRef(Date.now()); const arka = useRef<number | null>(null); const [kilitli, setKilitli] = useState(false); const [hata, setHata] = useState('');
  const dokun = useCallback(() => { son.current = Date.now(); return false; }, []);
  useEffect(() => {
    const t = setInterval(() => { if (Date.now() - son.current > KILIT_MS) setKilitli(true); }, 30_000);
    const a = AppState.addEventListener('change', (d) => {
      if (d !== 'active') arka.current = Date.now();
      else if (arka.current && Date.now() - arka.current > KILIT_MS) setKilitli(true);
    });
    return () => { clearInterval(t); a.remove(); };
  }, []);
  const ac = async () => {
    setHata('');
    const r = await LocalAuthentication.authenticateAsync({ promptMessage: 'YATONET 360 kilidini açın', cancelLabel: 'Vazgeç', disableDeviceFallback: false });
    if (r.success) { son.current = Date.now(); setKilitli(false); } else setHata('Doğrulama tamamlanamadı; yeniden deneyiniz.');
  };
  useEffect(() => { if (kilitli) void ac(); }, [kilitli]);
  return (
    <View style={{ flex: 1 }} onStartShouldSetResponderCapture={dokun}>
      {children}
      {kilitli && <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <Text style={{ fontSize: 20, color: LACI, marginBottom: 12 }}>Ekran Kilitlendi</Text>
        <Text style={{ textAlign: 'center', marginBottom: 20 }}>Güvenliğiniz için 15 dakika işlem yapılmadığında ekran kilitlenir.</Text>
        {hata ? <Text style={{ color: '#b42318', marginBottom: 12 }}>{hata}</Text> : null}
        <Pressable onPress={() => void ac()} style={{ backgroundColor: LACI, padding: 14, borderRadius: 8 }}><Text style={{ color: '#fff' }}>Kilidi Aç</Text></Pressable>
      </View>}
    </View>
  );
}
