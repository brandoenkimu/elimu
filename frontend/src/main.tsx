import '@fontsource-variable/source-sans-3';
import '@fontsource-variable/source-serif-4';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import { createRoot } from 'react-dom/client';
import App from './App';
import { applyTheme, loadLocalPrefs } from './lib/theme';
import './styles/base.css';
import './styles/landing.css';
import './styles/auth.css';
import './styles/app.css';
import './styles/chat.css';
import './styles/pages.css';

// Apply the saved look before the first paint so the page never flashes the wrong colours.
applyTheme(loadLocalPrefs());

createRoot(document.getElementById('root')!).render(<App />);
