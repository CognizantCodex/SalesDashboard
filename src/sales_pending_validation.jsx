import { useEffect } from 'react';
import { apiUrl } from './api.js';

const ENTITY_CONFIG = {
  sls: {
    formField: 'slsName',
    currentUrl: apiUrl('/api/pending-validation/summary/current')
  },
  slsm: {
    formField: 'slsmName',
    currentUrl: apiUrl('/api/slsm/pending-validation/summary/current')
  }
};

export default function SalesPendingValidation({ slsName, uploadVersion, onSummaryChange, entity = 'sls' }) {
  const config = ENTITY_CONFIG[entity] || ENTITY_CONFIG.sls;
  useEffect(() => {
    const trimmedName = slsName.trim();
    if (!trimmedName) {
      onSummaryChange(null);
      return undefined;
    }

    const controller = new AbortController();

    async function loadPendingValidationSummary() {
      try {
        const params = new URLSearchParams({
          [config.formField]: trimmedName,
          currentYear: String(new Date().getFullYear())
        });
        const response = await fetch(config.currentUrl + '?' + params.toString(), {
          signal: controller.signal
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.detail || payload.error || 'Pending validation summary failed.');

        onSummaryChange(payload.available ? payload : null);
      } catch (err) {
        if (err.name !== 'AbortError') onSummaryChange(null);
      }
    }

    loadPendingValidationSummary();
    return () => controller.abort();
  }, [slsName, uploadVersion, onSummaryChange]);

  return null;
}
