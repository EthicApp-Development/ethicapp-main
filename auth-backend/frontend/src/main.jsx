import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { AppProviders } from './app/providers';

import 'bootstrap/dist/css/bootstrap.min.css';
import './styles/index.css';
import './styles/auth.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AppProviders>
      <App />
    </AppProviders>
  </React.StrictMode>
);