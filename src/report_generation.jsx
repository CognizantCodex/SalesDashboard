import React, { useEffect, useState } from 'react';
import { apiUrl } from './api.js';

export default function ReportGeneration() {
  const [available, setAvailable] = useState(false);
  const [sourceFilename, setSourceFilename] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch(apiUrl('/api/demand-creation/current'))
      .then((response) => response.ok ? response.json() : null)
      .then((payload) => {
        setAvailable(Boolean(payload?.available));
        setSourceFilename(payload?.sourceFilename || '');
      })
      .catch(() => setAvailable(false));
  }, []);

  async function downloadReport() {
    setError('');
    setIsGenerating(true);
    try {
      const response = await fetch(apiUrl('/api/reports/export'));
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.detail || 'Unable to generate the PowerPoint report.');
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'Sales_Dashboard_Report.pptx';
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (reportError) {
      setError(reportError.message);
    } finally {
      setIsGenerating(false);
    }
  }

  return (
    <>
      <header>
        <svg width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 19V5m0 14h16M8 17V9m4 8V7m4 10v-5m4 5V4" /></svg>
        <h1>Report Generation <span>PowerPoint export</span></h1>
      </header>
      <main className="container report-generation-page">
        <section className="report-hero">
          <p className="report-eyebrow">Leadership reporting</p>
          <h2>Generate the executive dashboard report</h2>
          <p>The exported PowerPoint contains two editable slides: BCMI, followed by Demand Profile &amp; Top Accounts from the most recently saved Demand Creation workbook.</p>
        </section>
        <section className="report-slides" aria-label="Report contents">
          <article><span>01</span><h2>BCMI</h2><p>Commitment, RA, opportunities, key highlights, wins, and revenue erosion tables.</p></article>
          <article><span>02</span><h2>Demand Profile &amp; Top Accounts</h2><p>Demand Profile, weekly BCM/INS 2 chart, and the saved Top 10 Accounts table.</p></article>
        </section>
        <section className="report-action-card">
          <div><h2>Report data status</h2><p>{available ? `Ready to export from ${sourceFilename || 'the saved Demand Creation workbook'}.` : 'Upload a Demand Creation workbook before generating the PowerPoint.'}</p></div>
          <button className="report-download-button" type="button" disabled={!available || isGenerating} onClick={downloadReport}>{isGenerating ? 'Generating PowerPoint…' : 'Download PowerPoint'}</button>
        </section>
        {error && <p className="report-error" role="alert">{error}</p>}
      </main>
    </>
  );
}
