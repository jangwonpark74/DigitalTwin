// Presentation-only leaf shared by the current renderer and the React migration preview.
// Project state and persistence always belong to the caller, never this template.
export function renderEventsPanel(events, limit, h) {
  return h.panel('Recent activity', 'Local configuration actions only',
    `<div class="event-list">${events.slice(0, limit).map(entry => `<div class="event-item"><span class="event-bullet warn"></span><div><strong>${h.escape(entry.title)}</strong><small>${h.escape(entry.detail)}</small></div><span class="event-time">${new Date(entry.when).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span></div>`).join('')}</div>`,
    '<button class="button outline" data-go="activity">View all →</button>');
}

export function renderActivityView(events, h) {
  return h.header('Activity & handoff', 'Review local project edits and export a reproducible preparation manifest.') + h.banner() +
    `<div class="lower-grid">${renderEventsPanel(events, 80, h)}${h.panel('Integration handoff', 'What a production 5G twin still needs', '<div class="detail-copy"><p><b>1.</b> Import and georeference OpenStreetMap-derived geometry; add building/terrain RF materials.</p><p><b>2.</b> Bind site/cell parameters and antenna or MMU patterns to virtual O-RAN RU models.</p><p><b>3.</b> Verify the real vCore / vDU interface and time synchronization.</p><p><b>4.</b> Deploy Sionna-RT on H200 and software virtual UEs on Grace CPU in the target GH200 environment.</p><p><b>5.</b> Ingest verified paths, RSRP/SINR and protocol KPIs into versioned artifacts; only then replace the synthetic preview.</p></div><div class="pad"><button class="button primary" id="handoff-export">⇩ Export planning manifest</button></div>', h.badge('NOT IMPLEMENTED', 'warn'))}</div>`;
}
