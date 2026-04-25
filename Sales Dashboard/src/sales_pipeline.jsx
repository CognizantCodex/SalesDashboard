import React, { useState } from 'react';

export default function SalesPipeline() {
  const [pipelineWorkbook, setPipelineWorkbook] = useState(null);
  const [isPipelineDragging, setIsPipelineDragging] = useState(false);
  const [pipelineError, setPipelineError] = useState('');

  function selectPipelineWorkbook(file) {
    if (!file) {
      setPipelineWorkbook(null);
      setPipelineError('');
      return;
    }

    const allowed = /\.(xlsb|xlsx|xlsm)$/i.test(file.name);
    if (!allowed) {
      setPipelineError('Please select a .xlsb, .xlsx, or .xlsm workbook.');
      return;
    }

    setPipelineWorkbook(file);
    setPipelineError('');
  }

  function handlePipelineDrop(event) {
    event.preventDefault();
    setIsPipelineDragging(false);
    selectPipelineWorkbook(event.dataTransfer.files?.[0]);
  }

  return (
    <section
      className={'upload-card pipeline-upload' + (pipelineWorkbook ? ' done' : '') + (isPipelineDragging ? ' drag' : '')}
      onDragOver={(event) => {
        event.preventDefault();
        setIsPipelineDragging(true);
      }}
      onDragLeave={() => setIsPipelineDragging(false)}
      onDrop={handlePipelineDrop}
    >
      <label>
        <span className="upload-kicker">Pipeline</span>
        <svg className="upload-icon" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 19V5m0 14h16M8 17V9m4 8V7m4 10v-5m4 5V4" />
        </svg>
        <p className="upload-title">{pipelineWorkbook ? pipelineWorkbook.name : 'Drop your pipeline workbook here'}</p>
        <p className="upload-sub">
          {pipelineWorkbook
            ? 'Pipeline workbook selected'
            : 'Supports .xlsb and .xlsx'}
        </p>
        {pipelineError && <p className="upload-error">{pipelineError}</p>}
        <input
          type="file"
          accept=".xlsb,.xlsx,.xlsm"
          onChange={(event) => selectPipelineWorkbook(event.target.files?.[0] || null)}
        />
      </label>
    </section>
  );
}
