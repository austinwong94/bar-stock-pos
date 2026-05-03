import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './styles.css';

const basename = import.meta.env.BASE_URL === '/' ? undefined : import.meta.env.BASE_URL.replace(/\/$/, '');
const redirectedPath = sessionStorage.getItem('lovely_paradise_redirect');

if (redirectedPath) {
  sessionStorage.removeItem('lovely_paradise_redirect');
  window.history.replaceState(null, '', redirectedPath);
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter basename={basename}>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
);
