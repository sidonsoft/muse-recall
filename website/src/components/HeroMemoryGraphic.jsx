import React from 'react';
import Icon from './Icon.jsx';
import './HeroMemoryGraphic.css';

export default function HeroMemoryGraphic() {
  return (
    <figure className="memory-graphic" aria-labelledby="memory-graphic-title">
      <h2 id="memory-graphic-title">Say it once.</h2>
      <div className="memory-graphic-decision">
        <span className="memory-graphic-quote" aria-hidden="true">“</span>
        <p>Use ocean colours.</p>
        <div className="memory-graphic-swatches" aria-label="Navy, teal and seafoam colour palette">
          <i /><i /><i />
        </div>
      </div>

      <div className="memory-graphic-branches" aria-hidden="true">
        <svg viewBox="0 0 480 88" preserveAspectRatio="none">
          <path className="memory-graphic-wire" d="M240 0V43M80 88V64Q80 43 101 43H379Q400 43 400 64V88M240 43V88" />
          <circle cx="80" cy="85" r="3" /><circle cx="240" cy="85" r="3" /><circle cx="400" cy="85" r="3" />
        </svg>
        <span><Icon name="brain" /> Recall remembers</span>
      </div>

      <div className="memory-graphic-builds">
        <div className="memory-graphic-build">
          <div className="memory-graphic-window" aria-hidden="true">
            <div className="memory-graphic-chrome"><i /><i /><i /></div>
            <div className="memory-graphic-screen memory-graphic-first">
              <div className="memory-graphic-motif"><span /><span /><span /></div>
              <b /><small /><em />
            </div>
          </div>
          <span>First build</span>
        </div>
        <div className="memory-graphic-build">
          <div className="memory-graphic-window" aria-hidden="true">
            <div className="memory-graphic-chrome"><i /><i /><i /></div>
            <div className="memory-graphic-screen memory-graphic-second">
              <b /><div className="memory-graphic-tiles"><i /><i /><i /><i /></div>
            </div>
          </div>
          <span>Next edit</span>
        </div>
        <div className="memory-graphic-build">
          <div className="memory-graphic-window" aria-hidden="true">
            <div className="memory-graphic-chrome"><i /><i /><i /></div>
            <div className="memory-graphic-screen memory-graphic-third">
              <b /><div className="memory-graphic-rows"><i /><i /><i /></div>
            </div>
          </div>
          <span>New session</span>
        </div>
      </div>
      <p className="memory-graphic-payoff">The decision comes with you.</p>
    </figure>
  );
}
