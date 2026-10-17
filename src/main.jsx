import { createRoot } from 'react-dom/client';
// Fonts are bundled with the app (no network needed): Caslon for the ledger's
// headings and figures, Schibsted Grotesk for UI text, Plex Mono for data,
// Caveat for Alfred's handwritten notes.
import '@fontsource/libre-caslon-display/400.css';
import '@fontsource/libre-caslon-text/400.css';
import '@fontsource/libre-caslon-text/400-italic.css';
import '@fontsource/libre-caslon-text/700.css';
import '@fontsource-variable/schibsted-grotesk/wght.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import '@fontsource/caveat/600.css';
import App from './App.jsx';
import './styles.css';

// Apply a pinned theme before the first paint (the sidebar toggle sets it).
try {
  const theme = localStorage.getItem('alfred-theme');
  if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;
} catch {
  // Storage unavailable; follow the OS theme.
}

createRoot(document.getElementById('root')).render(<App />);
