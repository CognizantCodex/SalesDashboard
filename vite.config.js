import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.jsx',
    globals: true,
    coverage: {
      provider: 'v8',
      reporter: ['text'],
      include: [
        'src/ForecastApp.jsx',
        'src/sales_forecast.jsx',
        'src/sales_summary.jsx',
        'src/upload_option.jsx',
        'src/sales_won_lost.jsx',
        'src/sales_pending_validation.jsx'
      ],
      thresholds: {
        statements: 90,
        lines: 90
      }
    }
  }
});
