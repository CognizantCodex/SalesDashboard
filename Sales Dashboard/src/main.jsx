import React from 'react';
import { createRoot } from 'react-dom/client';
import SalesForecast from './sales_forecast.jsx';
import './styles.css';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <SalesForecast />
  </React.StrictMode>
);
