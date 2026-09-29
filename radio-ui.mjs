const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[character]));

function configField(site, label, property, value, { type = 'text', placeholder = '', attrs = '' } = {}) {
  return `<label class="form-field"><span>${label}</span><input type="${type}" data-radio-config="${site.id}" data-prop="${property}" value="${escapeHtml(value ?? '')}" placeholder="${escapeHtml(placeholder)}" ${attrs}/></label>`;
}

function locationField(site, label, property, value) {
  const displayed = Number.isFinite(value) ? Number(value.toFixed(6)) : '';
  return `<label class="form-field"><span>${label}</span><input type="number" data-radio-location="${site.id}" data-prop="${property}" value="${displayed}" step="0.000001" min="${property === 'latitude' ? '-90' : '-180'}" max="${property === 'latitude' ? '90' : '180'}" placeholder="Not set"/></label>`;
}

function sectorTable(site) {
  return `<div class="radio-table-wrap"><table class="radio-sector-table"><thead><tr><th>Sector</th><th>Azimuth</th><th>Bandwidth</th><th>Tx power</th></tr></thead><tbody>${site.cells.map(cell => `<tr><th scope="row">${escapeHtml(cell.id)}</th><td>${cell.azimuthDeg}°</td><td>${cell.bandwidthMhz} MHz</td><td>${cell.txPowerDbm} dBm</td></tr>`).join('')}</tbody></table></div><div class="radio-sector-actions"><span>Sector alignment and power are configured in the cell planner.</span><button class="button outline" data-go="planner">Edit sectors →</button></div>`;
}

export function radioPlannerView(project, helpers, { selectedSiteId = project.sites[0]?.id } = {}) {
  const site = project.sites.find(candidate => candidate.id === selectedSiteId) || project.sites[0];
  if (!site) return helpers.header('Radio planner', 'No radio sites are available.') + helpers.banner();

  const radio = site.radio;
  const location = site.radioLocation;
  const hasLatitude = Number.isFinite(location.latitude), hasLongitude = Number.isFinite(location.longitude);
  const located = hasLatitude && hasLongitude, partialLocation = hasLatitude !== hasLongitude;
  const locationState = located ? 'Coordinates set' : partialLocation ? 'Enter both coordinates' : 'Coordinates not set';
  const sourceLabel = location.source === 'map-estimate' ? 'Schematic-map estimate' : location.source === 'manual' ? 'Manually entered' : 'Unassigned';
  const sourceBadge = located ? '' : helpers.badge(partialLocation ? 'COMPLETE LAT / LON' : 'ENTER OR PLACE', 'warn');
  const siteCards = project.sites.map(item => {
    const hasLocation = Number.isFinite(item.radioLocation.latitude) && Number.isFinite(item.radioLocation.longitude);
    return `<button type="button" class="radio-site-card ${item.id === site.id ? 'active' : ''}" data-radio-site="${item.id}" aria-pressed="${item.id === site.id}"><span class="radio-site-number">${escapeHtml(item.id)}</span><strong>${escapeHtml(item.name)}</strong><small>Front end: ${item.frontEnd === 'MMU' ? 'MMU' : 'Antenna'} · Location: ${hasLocation ? 'set' : 'needed'}</small></button>`;
  }).join('');
  const sectors = sectorTable(site);
  const radioUnit = `<div class="radio-field-grid"><div class="radio-vendor"><span>Target manufacturer</span><strong>${escapeHtml(radio.manufacturer)}</strong><small>Planning target · no model compatibility asserted</small></div><label class="form-field"><span>Radio technology</span><select class="select" data-radio-config="${site.id}" data-prop="technology">${['4G LTE', '5G NR', '4G LTE + 5G NR'].map(option => `<option ${radio.technology === option ? 'selected' : ''}>${option}</option>`).join('')}</select></label>${configField(site, 'RU model / part number', 'ruModel', radio.ruModel, { placeholder: `Add confirmed ${radio.manufacturer} model` })}${configField(site, 'Band / spectrum profile', 'band', radio.band, { placeholder: 'e.g. B3 or n78' })}</div><p class="radio-inline-note">Enter exact vendor part numbers only when confirmed; this planner does not validate catalog compatibility or licensing.</p>`;
  const mmuFields = site.frontEnd === 'MMU'
    ? `${configField(site, 'MMU model / reference', 'mmuModel', radio.mmuModel, { placeholder: 'Add confirmed MMU model' })}${configField(site, 'Array elements', 'mmuElements', radio.mmuElements, { type: 'number', placeholder: 'Not set', attrs: 'min="1" max="1024" step="1"' })}${configField(site, 'Beamforming profile', 'beamformingProfile', radio.beamformingProfile, { placeholder: 'Profile name or note' })}`
    : '<div class="radio-front-end-help"><strong>Antenna front end selected</strong><span>Select MMU to configure its model, array elements, and beamforming profile.</span></div>';
  const mmu = `<div class="radio-field-grid"><label class="form-field"><span>RF front end</span><select class="select" data-radio-front-end="${site.id}"><option ${site.frontEnd === 'Antenna' ? 'selected' : ''}>Antenna</option><option ${site.frontEnd === 'MMU' ? 'selected' : ''}>MMU</option></select></label>${mmuFields}</div><p class="radio-inline-note">MMU values are site-specific planning inputs; they do not validate vendor compatibility or a calibrated antenna pattern.</p>`;
  const geo = `<div class="radio-location-status"><div><span class="radio-state-dot ${located ? 'set' : ''}"></span><strong>${locationState}</strong><small>${sourceLabel}</small></div>${sourceBadge}</div><div class="radio-field-grid radio-coordinate-fields">${locationField(site, 'Latitude', 'latitude', location.latitude)}${locationField(site, 'Longitude', 'longitude', location.longitude)}</div><p class="radio-coordinate-hint">Enter coordinates manually or place the radio on the map.</p><div class="radio-location-actions"><button type="button" class="button primary" data-radio-place="${site.id}">⌖ Place on map</button><button type="button" class="button outline" data-go="map">View map scope</button></div><p class="radio-location-note">Map placement estimates coordinates from the configured center and radius; the schematic canvas is not a real basemap. Prefer verified site coordinates for deployment.</p>`;

  return helpers.header('Radio planner', 'Configure the Samsung RU, RF front end, and location for each planned radio site.') + helpers.banner() +
    `<section class="radio-site-section" aria-label="Radio locations"><div class="radio-section-heading"><div><h2>Radio locations</h2><p>Select a site to edit its RU, MMU, and geographic position.</p></div><span>${project.sites.length} planned ${project.sites.length === 1 ? 'location' : 'locations'}</span></div><div class="radio-site-switcher">${siteCards}</div></section>` +
    `<div class="radio-planner-grid">${helpers.panel('Radio unit', `${escapeHtml(site.name)} · Samsung RU target`, radioUnit)}${helpers.panel('Geographic location', `Map scope center ${project.map.latitude.toFixed(4)}, ${project.map.longitude.toFixed(4)} · radius ${project.map.radiusMeters} m`, geo)}</div>` +
    `<div class="radio-planner-grid radio-planner-lower">${helpers.panel('MMU & RF front end', 'Site-specific front-end configuration · compatibility unverified', mmu)}${helpers.panel('Sector summary', 'Current per-site cell parameters', sectors, helpers.badge(`${site.cells.length} SECTORS`))}</div>`;
}
