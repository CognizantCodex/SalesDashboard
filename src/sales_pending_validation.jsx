import { useEffect } from 'react';

const PENDING_VALIDATION_CURRENT_URL = 'http://127.0.0.1:3001/api/pending-validation/summary/current';

export default function SalesPendingValidation({ slsName, uploadVersion, onSummaryChange }) {
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
          slsName: trimmedName,
          currentYear: String(new Date().getFullYear())
        });
        const response = await fetch(PENDING_VALIDATION_CURRENT_URL + '?' + params.toString(), {
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
