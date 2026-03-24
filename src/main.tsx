
// Handle redirect from root to /Gratis-LA if accessed via 0xcosmosly.github.io/
if (window.location.hostname === '0xcosmosly.github.io' && (window.location.pathname === '/' || window.location.pathname === '')) {
  window.location.replace('/Gratis-LA/');
}

import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import 'leaflet/dist/leaflet.css';
import './styles.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch((error) => {
      console.error('Could not register service worker:', error);
    });
  });
}
