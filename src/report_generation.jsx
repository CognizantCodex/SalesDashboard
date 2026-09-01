import React, { useEffect, useState } from 'react';
import { apiUrl } from './api.js';
import LoadingSpinner from './loading_spinner.jsx';

export default function ReportGeneration() {
  const [available, setAvailable] = useState(false);
  const [sourceFilename, setSourceFilename] = useState('');
  const [raAvailable, setRaAvailable] = useState(false);
  const [raSourceFilename, setRaSourceFilename] = useState('');
  const [raRowsSaved, setRaRowsSaved] = useState(0);
  const [isUploadingRa, setIsUploadingRa] = useState(false);
  const [frontierAvailable, setFrontierAvailable] = useState(false);
  const [frontierSourceFilename, setFrontierSourceFilename] = useState('');
  const [frontierRowsSaved, setFrontierRowsSaved] = useState(0);
  const [isUploadingFrontier, setIsUploadingFrontier] = useState(false);
  const [frontierModelsAvailable, setFrontierModelsAvailable] = useState(false);
  const [frontierModelsSourceFilename, setFrontierModelsSourceFilename] = useState('');
  const [frontierModelsRowsSaved, setFrontierModelsRowsSaved] = useState(0);
  const [isUploadingFrontierModels, setIsUploadingFrontierModels] = useState(false);
  const [erosionAvailable, setErosionAvailable] = useState(false);
  const [erosionSourceFilename, setErosionSourceFilename] = useState('');
  const [erosionRowsSaved, setErosionRowsSaved] = useState(0);
  const [isUploadingErosion, setIsUploadingErosion] = useState(false);
  const [workableDemandAvailable, setWorkableDemandAvailable] = useState(false);
  const [workableDemandSourceFilename, setWorkableDemandSourceFilename] = useState('');
  const [workableDemandRowsSaved, setWorkableDemandRowsSaved] = useState(0);
  const [isUploadingWorkableDemand, setIsUploadingWorkableDemand] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isLoadingStatus, setIsLoadingStatus] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([
      fetch(apiUrl('/api/demand-creation/current')).then((response) => response.ok ? response.json() : null),
      fetch(apiUrl('/api/reports/ra/current')).then((response) => response.ok ? response.json() : null),
      fetch(apiUrl('/api/reports/frontier-security-defense/current')).then((response) => response.ok ? response.json() : null),
      fetch(apiUrl('/api/reports/frontier-models/current')).then((response) => response.ok ? response.json() : null),
      fetch(apiUrl('/api/reports/erosion/current')).then((response) => response.ok ? response.json() : null),
      fetch(apiUrl('/api/reports/workable-demand/current')).then((response) => response.ok ? response.json() : null)
    ]).then(([demand, ra, frontier, frontierModels, erosion, workableDemand]) => {
      setAvailable(Boolean(demand?.available));
      setSourceFilename(demand?.sourceFilename || '');
      setRaAvailable(Boolean(ra?.available));
      setRaSourceFilename(ra?.sourceFilename || '');
      setRaRowsSaved(ra?.rowsSaved || 0);
      setFrontierAvailable(Boolean(frontier?.available));
      setFrontierSourceFilename(frontier?.sourceFilename || '');
      setFrontierRowsSaved(frontier?.rowsSaved || 0);
      setFrontierModelsAvailable(Boolean(frontierModels?.available));
      setFrontierModelsSourceFilename(frontierModels?.sourceFilename || '');
      setFrontierModelsRowsSaved(frontierModels?.rowsSaved || 0);
      setErosionAvailable(Boolean(erosion?.available));
      setErosionSourceFilename(erosion?.sourceFilename || '');
      setErosionRowsSaved(erosion?.rowsSaved || 0);
      setWorkableDemandAvailable(Boolean(workableDemand?.available));
      setWorkableDemandSourceFilename(workableDemand?.sourceFilename || '');
      setWorkableDemandRowsSaved(workableDemand?.rowsSaved || 0);
    }).catch(() => setAvailable(false)).finally(() => setIsLoadingStatus(false));
  }, []);

  async function uploadRaWorkbook(event) {
    const workbook = event.target.files?.[0];
    if (!workbook) return;
    setError('');
    setIsUploadingRa(true);
    try {
      const formData = new FormData();
      formData.append('workbook', workbook);
      const response = await fetch(apiUrl('/api/reports/ra/upload'), { method: 'POST', body: formData });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.detail || 'Unable to upload the RA workbook.');
      setRaAvailable(Boolean(payload.available));
      setRaSourceFilename(payload.sourceFilename || workbook.name);
      setRaRowsSaved(payload.database?.rowsSaved || 0);
    } catch (uploadError) {
      setError(uploadError.message);
    } finally {
      setIsUploadingRa(false);
      event.target.value = '';
    }
  }

  async function uploadFrontierWorkbook(event) {
    const workbook = event.target.files?.[0];
    if (!workbook) return;
    setError('');
    setIsUploadingFrontier(true);
    try {
      const formData = new FormData();
      formData.append('workbook', workbook);
      const response = await fetch(apiUrl('/api/reports/frontier-security-defense/upload'), { method: 'POST', body: formData });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.detail || 'Unable to upload the Frontier Security & Defense workbook.');
      setFrontierAvailable(Boolean(payload.available));
      setFrontierSourceFilename(payload.sourceFilename || workbook.name);
      setFrontierRowsSaved(payload.database?.rowsSaved || 0);
    } catch (uploadError) {
      setError(uploadError.message);
    } finally {
      setIsUploadingFrontier(false);
      event.target.value = '';
    }
  }

  async function uploadFrontierModelsWorkbook(event) {
    const workbook = event.target.files?.[0];
    if (!workbook) return;
    setError('');
    setIsUploadingFrontierModels(true);
    try {
      const formData = new FormData();
      formData.append('workbook', workbook);
      const response = await fetch(apiUrl('/api/reports/frontier-models/upload'), { method: 'POST', body: formData });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.detail || 'Unable to upload the Frontier Models workbook.');
      setFrontierModelsAvailable(Boolean(payload.available));
      setFrontierModelsSourceFilename(payload.sourceFilename || workbook.name);
      setFrontierModelsRowsSaved(payload.database?.rowsSaved || 0);
    } catch (uploadError) {
      setError(uploadError.message);
    } finally {
      setIsUploadingFrontierModels(false);
      event.target.value = '';
    }
  }

  async function uploadErosionWorkbook(event) {
    const workbook = event.target.files?.[0];
    if (!workbook) return;
    setError('');
    setIsUploadingErosion(true);
    try {
      const formData = new FormData();
      formData.append('workbook', workbook);
      const response = await fetch(apiUrl('/api/reports/erosion/upload'), { method: 'POST', body: formData });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.detail || 'Unable to upload the Erosion workbook.');
      setErosionAvailable(Boolean(payload.available));
      setErosionSourceFilename(payload.sourceFilename || workbook.name);
      setErosionRowsSaved(payload.database?.rowsSaved || 0);
    } catch (uploadError) {
      setError(uploadError.message);
    } finally {
      setIsUploadingErosion(false);
      event.target.value = '';
    }
  }

  async function uploadWorkableDemandWorkbook(event) {
    const workbook = event.target.files?.[0];
    if (!workbook) return;
    setError('');
    setIsUploadingWorkableDemand(true);
    try {
      const formData = new FormData();
      formData.append('workbook', workbook);
      const response = await fetch(apiUrl('/api/reports/workable-demand/upload'), { method: 'POST', body: formData });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.detail || 'Unable to upload the Workable Demand workbook.');
      setWorkableDemandAvailable(Boolean(payload.available));
      setWorkableDemandSourceFilename(payload.sourceFilename || workbook.name);
      setWorkableDemandRowsSaved(payload.database?.rowsSaved || 0);
    } catch (uploadError) {
      setError(uploadError.message);
    } finally {
      setIsUploadingWorkableDemand(false);
      event.target.value = '';
    }
  }

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
        {isLoadingStatus ? <LoadingSpinner label="Loading saved report data…" /> : <>
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
        <section className="report-action-card report-ra-upload-card">
          <div><h2>RA Path to Recovery</h2><p>{raAvailable ? `${raSourceFilename || 'RA workbook'} saved with ${raRowsSaved.toLocaleString()} rows from Q3 BU RA - Americas and Q4 RA - Americas.` : 'Upload an RA workbook to save the Q3 and Q4 Americas RA sheets.'}</p></div>
          <label className="report-download-button report-upload-button">{isUploadingRa ? 'Uploading RA…' : 'Upload RA File'}<input type="file" accept=".xlsx,.xlsm,.xlsb" onChange={uploadRaWorkbook} disabled={isUploadingRa} /></label>
        </section>
        <section className="report-action-card report-ra-upload-card">
          <div><h2>Frontier Security &amp; Defense Opportunities</h2><p>{frontierAvailable ? `${frontierSourceFilename || 'Opportunity workbook'} saved with ${frontierRowsSaved.toLocaleString()} opportunity rows.` : 'Upload the Opportunity Input sheet to save Frontier Security & Defense opportunities.'}</p></div>
          <label className="report-download-button report-upload-button">{isUploadingFrontier ? 'Uploading opportunities…' : 'Upload Opportunities'}<input type="file" accept=".xlsx,.xlsm,.xlsb" onChange={uploadFrontierWorkbook} disabled={isUploadingFrontier} /></label>
        </section>
        <section className="report-action-card report-ra-upload-card">
          <div><h2>Frontier Models</h2><p>{frontierModelsAvailable ? `${frontierModelsSourceFilename || 'Frontier Models workbook'} saved with ${frontierModelsRowsSaved.toLocaleString()} rows. Uploading a new workbook replaces this saved mapping.` : 'Upload the Frontier Models mapping workbook. A new upload replaces the previous mapping.'}</p></div>
          <label className="report-download-button report-upload-button">{isUploadingFrontierModels ? 'Uploading Frontier Models…' : 'Upload Frontier Models'}<input type="file" accept=".xlsx,.xlsm,.xlsb" onChange={uploadFrontierModelsWorkbook} disabled={isUploadingFrontierModels} /></label>
        </section>
        <section className="report-action-card report-ra-upload-card">
          <div><h2>Erosion</h2><p>{erosionAvailable ? `${erosionSourceFilename || 'Erosion workbook'} saved with ${erosionRowsSaved.toLocaleString()} rows. Uploading a new workbook replaces this saved Erosion data.` : 'Upload the Erosion workbook. A new upload replaces the previous Erosion data.'}</p></div>
          <label className="report-download-button report-upload-button">{isUploadingErosion ? 'Uploading Erosion…' : 'Upload Erosion'}<input type="file" accept=".xlsx,.xlsm,.xlsb" onChange={uploadErosionWorkbook} disabled={isUploadingErosion} /></label>
        </section>
        <section className="report-action-card report-ra-upload-card">
          <div><h2>Workable Demand Report</h2><p>{workableDemandAvailable ? `${workableDemandSourceFilename || 'Workable Demand workbook'} saved with ${workableDemandRowsSaved.toLocaleString()} Base-sheet rows. Uploading a new workbook replaces this saved data.` : 'Upload a Workable Demand workbook to save its Base-sheet data. A new upload replaces the previous data.'}</p></div>
          <label className="report-download-button report-upload-button">{isUploadingWorkableDemand ? 'Uploading Workable Demand…' : 'Upload Workable Demand'}<input type="file" accept=".xlsx,.xlsm,.xlsb" onChange={uploadWorkableDemandWorkbook} disabled={isUploadingWorkableDemand} /></label>
        </section>
        {error && <p className="report-error" role="alert">{error}</p>}
        </>}
      </main>
    </>
  );
}
