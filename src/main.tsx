import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, HashRouter } from 'react-router-dom';
import App from './App';
import { isDemoMode } from './lib/supabase';
import './styles.css';

const basename = import.meta.env.BASE_URL === '/' ? undefined : import.meta.env.BASE_URL.replace(/\/$/, '');
const redirectedPath = sessionStorage.getItem('lovely_paradise_redirect');

if (redirectedPath) {
  sessionStorage.removeItem('lovely_paradise_redirect');
  window.history.replaceState(null, '', redirectedPath);
}

const Router = isDemoMode
  ? ({ children }: { children: React.ReactNode }) => <HashRouter>{children}</HashRouter>
  : ({ children }: { children: React.ReactNode }) => <BrowserRouter basename={basename}>{children}</BrowserRouter>;

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Router>
      <App />
    </Router>
  </React.StrictMode>,
);
