import React from 'react';

export default function LoadingSpinner({ label = 'Loading data…' }) {
  return <div className="page-loading" role="status"><span className="spinner" aria-hidden="true" /><span>{label}</span></div>;
}
