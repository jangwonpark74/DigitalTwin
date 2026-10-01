import { ARCHITECTURE_BLOCKS } from '../../../stack-ui.mjs';
import './mission-control.css';

/** The active renderer and this leaf use the same physical/virtual planning descriptors. */
export default function MissionControlArchitecture() {
  return <section className="mission-control-architecture" aria-label="End-to-end twin boundary">
    <header><div><h2>End-to-end twin boundary</h2>
      <p>Physical network to virtual radio and CPU-based UEs</p></div><span>TARGET ARCHITECTURE</span></header>
    <p className="mission-control-architecture-hint">Scroll the architecture diagram horizontally to inspect all six stages.</p>
    <div className="mission-control-architecture-scroll" role="region" aria-label="RAN architecture diagram" tabIndex={0}>
      <div className="mission-control-architecture-flow">
        {ARCHITECTURE_BLOCKS.map(([name, kind, icon, mode], index) => <div className="mission-control-architecture-part" key={name}>
          <div data-testid="architecture-block" className={`mission-control-architecture-block ${mode}`}>
            <span aria-hidden="true">{icon}</span><strong>{name}</strong><small>{kind}</small>
          </div>
          {index < ARCHITECTURE_BLOCKS.length - 1 && <span aria-hidden="true">→</span>}
        </div>)}
      </div>
    </div>
    <footer><span>PHYSICAL NETWORK SIDE</span><span>VIRTUALIZATION ON GH200 · H200 GPU + GRACE CPU</span></footer>
  </section>;
}
