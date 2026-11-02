import '@fontsource/source-sans-3/400.css';
import '@fontsource/source-sans-3/600.css';
import '@fontsource/source-sans-3/700.css';
import '@fontsource/source-serif-4/400.css';
import '@fontsource/source-serif-4/400-italic.css';
import { createRoot } from 'react-dom/client';
import './stil.css';
import './stil_ilk.css';
import './stil_kabuk.css';
import { Bekleme } from './Bekleme';
import { Uygulama } from './Uygulama';

createRoot(document.getElementById('kok')!).render(<><Uygulama /><Bekleme /></>);
