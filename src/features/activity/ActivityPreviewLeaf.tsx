type ActivityItem = { when: string; title: string; detail: string };
type ActivityRecord = { id: string; name: string; activity: ActivityItem[] };

export default function ActivityPreviewLeaf({ record, onExport }: { record: ActivityRecord; onExport: () => void | Promise<void> }) {
  return <section className="activity-leaf" role="region" aria-label="Activity preview route">
    <header><div><p className="eyebrow">PROJECT · {record.name}</p><h1>Activity &amp; handoff</h1>
      <p>Review local project edits and export a reproducible preparation manifest.</p></div></header>
    <p className="artifacts-boundary">Local configuration actions only · activity is scoped to this project.</p>
    <div className="lower-grid">
      <section className="panel"><header><div><h2>Recent activity</h2><p>Local configuration actions only.</p></div></header>
        {record.activity.length === 0 ? <p className="detail-copy">No project activity has been recorded yet.</p>
          : <ul className="event-list" aria-label="Recent activity">
            {record.activity.slice(0, 80).map((entry, index) => <li className="event-item" key={`${entry.when}:${entry.title}:${index}`}>
              <span className="event-bullet warn" aria-hidden="true" />
              <span><strong>{entry.title}</strong><small>{entry.detail}</small></span>
              <time className="event-time" dateTime={entry.when}>{new Date(entry.when).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time>
            </li>)}
          </ul>}
      </section>
      <section className="panel"><header><div><h2>Integration handoff</h2><p>What a production 5G twin still needs.</p></div>
        <span className="mini-pill warn">NOT IMPLEMENTED</span></header>
        <div className="detail-copy"><p><b>1.</b> Import and georeference OpenStreetMap-derived geometry; add building/terrain RF materials.</p>
          <p><b>2.</b> Bind site/cell parameters and antenna or MMU patterns to virtual O-RAN RU models.</p>
          <p><b>3.</b> Verify the real vCore / vDU interface and time synchronization.</p>
          <p><b>4.</b> Deploy Sionna-RT on H200 and software virtual UEs on Grace CPU in the target GH200 environment.</p>
          <p><b>5.</b> Ingest verified paths, RSRP/SINR and protocol KPIs into versioned artifacts; only then replace the synthetic preview.</p></div>
        <div className="pad"><button type="button" className="button primary" onClick={() => { void onExport(); }}>⇩ Export planning manifest</button></div>
      </section>
    </div>
  </section>;
}
