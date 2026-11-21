import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './theme.css';
import './styles.css';
import './shell.css';
import './wealth.css';
import './flow.css';
import { installRipple } from './lib/motion.jsx';

installRipple();

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
