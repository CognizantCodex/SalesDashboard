import React from 'react';
import { vi } from 'vitest';

export function jsonResponse(payload, ok = true) {
  return Promise.resolve({
    ok,
    json: () => Promise.resolve(payload),
    text: () => Promise.resolve(JSON.stringify(payload))
  });
}

export function file(name = 'book.xlsx') {
  return new File(['test'], name, {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  });
}

export function fileList(selectedFile) {
  return {
    0: selectedFile,
    length: selectedFile ? 1 : 0,
    item: (index) => (index === 0 ? selectedFile : null)
  };
}

export function revenueMetrics(overrides = {}) {
  return {
    forecast: 1000,
    target: 1500,
    gap: 500,
    accounts: 2,
    labels: {
      forecast: '$1.0M',
      target: '$1.5M',
      gap: '$0.5M'
    },
    status: 'behind',
    ...overrides
  };
}

export function pipelineSummary(overrides = {}) {
  return {
    available: true,
    query: 'Seller A',
    year: 2026,
    matchedSlsNames: ['Seller A'],
    metrics: {
      pipeline: 1000000,
      qualified: 700000,
      unqualified: 300000,
      accounts: 1,
      rows: 2,
      labels: {
        pipeline: '$1.0M',
        qualified: '$0.7M',
        unqualified: '$0.3M'
      }
    },
    rows: [],
    accounts: [],
    ...overrides
  };
}

export function wonSummary(overrides = {}) {
  return {
    available: true,
    query: 'Seller A',
    year: 2026,
    metrics: {
      won: 2000000,
      labels: { won: '$2.0M' }
    },
    rows: [],
    ...overrides
  };
}

export function pendingSummary(overrides = {}) {
  return {
    available: true,
    query: 'Seller A',
    year: 2026,
    metrics: {
      pendingValidation: 500000,
      labels: { pendingValidation: '$0.5M' }
    },
    rows: [],
    ...overrides
  };
}

export function slslSummaryPayload() {
  return {
    available: true,
    rows: [
      {
        slsmName: 'Alpha Manager',
        revenue: { ...revenueMetrics(), status: 'behind' },
        pipeline: pipelineSummary().metrics,
        realizedTcv: {
          total: 2500000,
          won: 2000000,
          pendingValidation: 500000,
          labels: { total: '$2.5M', won: '$2.0M', pendingValidation: '$0.5M' }
        }
      }
    ]
  };
}

export function slsBreakdownPayload() {
  return {
    available: true,
    rows: [
      {
        slsName: 'Seller A',
        revenue: { ...revenueMetrics(), status: 'behind' },
        pipeline: pipelineSummary().metrics,
        realizedTcv: {
          total: 2500000,
          won: 2000000,
          pendingValidation: 500000,
          labels: { total: '$2.5M', won: '$2.0M', pendingValidation: '$0.5M' }
        }
      }
    ]
  };
}

export function mockFetch(handler) {
  global.fetch = vi.fn((url, options = {}) => {
    const value = handler(String(url), options);
    return value instanceof Promise ? value : jsonResponse(value);
  });
  return global.fetch;
}

export function MockDetails({ title = 'Details', onBack }) {
  return (
    <div>
      <h1>{title}</h1>
      <button onClick={onBack}>Back to Dashboard</button>
    </div>
  );
}
