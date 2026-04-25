import React from 'react';
import { createRoot } from 'react-dom/client';
import ForecastApp from './ForecastApp.jsx';
import './styles.css';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ForecastApp />
  </React.StrictMode>
);
