import React, { useState } from 'react';

const ICON_PATHS = {
  revenue: 'M12 16V8m0 0-3 3m3-3 3 3M20 16.5A3.5 3.5 0 0 0 16.5 13H15a5 5 0 1 0-9.9 1.5',
  pipeline: 'M4 19V5m0 14h16M8 17V9m4 8V7m4 10v-5m4 5V4'
};

export default function UploadOption({
  className = '',
  label,
  title,
  subtitle,
  error = '',
  accept = '.xlsb,.xlsx,.xlsm',
  icon = 'pipeline',
  isComplete = false,
  onFileSelect
}) {
  const [isDragging, setIsDragging] = useState(false);

  function handleDrop(event) {
    event.preventDefault();
    setIsDragging(false);
    onFileSelect?.(event.dataTransfer.files?.[0] || null, 'drop');
  }

  return (
    <section
      className={'upload-card ' + className + (isComplete ? ' done' : '') + (isDragging ? ' drag' : '')}
      onDragOver={(event) => {
        event.preventDefault();
        setIsDragging(true);
      }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={handleDrop}
    >
      <label>
        <span className="upload-kicker">{label}</span>
        <svg className="upload-icon" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" aria-hidden="true">
          <path d={ICON_PATHS[icon] || ICON_PATHS.pipeline} />
        </svg>
        <p className="upload-title">{title}</p>
        <p className="upload-sub">{subtitle}</p>
        {error && <p className="upload-error">{error}</p>}
        <input
          type="file"
          accept={accept}
          onChange={(event) => onFileSelect?.(event.target.files?.[0] || null, 'select')}
        />
      </label>
    </section>
  );
}
