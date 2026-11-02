import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/fraunces/opsz.css';
import '@fontsource-variable/onest';
import '@fontsource-variable/jetbrains-mono';
import 'katex/dist/katex.min.css';
import './styles/base.css';
import './styles/login.css';
import './styles/app.css';
import './styles/markdown.css';
import App from './App';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
