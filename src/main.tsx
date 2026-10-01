import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './app/App';
import './shared/styles/tokens.css';
import './shared/styles/product.css';

const root = document.getElementById('react-preview-root');
if (!root) throw new Error('React preview root is missing.');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
