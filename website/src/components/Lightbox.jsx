import React, { useEffect, useRef } from 'react';

export default function Lightbox({ shots, index, onClose, onMove }) {
  const closeRef = useRef(null);
  const triggerRef = useRef(document.activeElement);

  useEffect(() => {
    closeRef.current?.focus();
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
      triggerRef.current?.focus?.();
    };
  }, []);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight') onMove(1);
      else if (e.key === 'ArrowLeft') onMove(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, onMove]);

  const s = shots[index];
  return (
    <div className="lb-backdrop" onClick={onClose} role="dialog" aria-modal="true" aria-label={s.t}>
      <figure className="lb-figure" onClick={(e) => e.stopPropagation()}>
        <picture>
          <source srcSet={s.src.replace(/\.(png|jpe?g)$/, '.webp')} type="image/webp" />
          <img src={s.src} alt={s.c} decoding="async" />
        </picture>
        <figcaption>
          <b>{s.t}</b> {s.c}
        </figcaption>
        <div className="lb-bar">
          <button onClick={() => onMove(-1)} aria-label="Previous screenshot">←</button>
          <span className="lb-count">{index + 1} / {shots.length}</span>
          <button onClick={() => onMove(1)} aria-label="Next screenshot">→</button>
          <button
            className="lb-close"
            ref={closeRef}
            onClick={onClose}
            aria-label="Close viewer (Escape)"
          >
            ✕ Esc
          </button>
        </div>
      </figure>
    </div>
  );
}
