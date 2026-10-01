import test from 'node:test';
import assert from 'node:assert/strict';
import { ARCHITECTURE_BLOCKS, renderArchitectureStrip, renderStackView } from './stack-ui.mjs';

const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const helpers = {
  escape,
  header: title => `<header><h1>${title}</h1></header>`,
  banner: () => '<aside>Preparation workspace · RAN integration not connected</aside>',
  badge: text => `<span>${text}</span>`,
  panel: (title, caption, body, extra = '') => `<section><h2>${title}</h2><p>${caption}</p>${extra}${body}</section>`,
  field: (label, path, value) => `<label>${label}<input data-field="${path}" value="${escape(value)}"></label>`,
};

test('shared architecture descriptors preserve the six legacy physical/virtual boundary blocks', () => {
  const blocks = [
    ['vCore','REAL NETWORK ELEMENT','CORE','real'],['vDU','REAL NETWORK ELEMENT','RAN DU','real'],
    ['O-RAN RU','VIRTUAL COMPONENT','RU','virtual'],['Antenna / MMU','VIRTUAL RF FRONT END','RF','virtual'],
    ['Sionna-RT','CHANNEL · PLANNED','RT','planned'],['Software UE','VIRTUAL · GRACE CPU','UE','virtual'],
  ];
  assert.deepEqual(ARCHITECTURE_BLOCKS, blocks);
  assert.equal(renderArchitectureStrip(helpers), helpers.panel('End-to-end twin boundary',
    'Physical network to virtual radio and CPU-based UEs',
    `<div class="stack-flow">${blocks.map(([name,kind,icon,mode],i) => `<div class="stack-part"><div class="stack-block ${mode}"><div class="stack-glyph">${icon}</div><strong>${name}</strong><small>${kind}</small></div>${i < blocks.length - 1 ? '<span class="stack-arrow">→</span>' : ''}</div>`).join('')}</div><div class="stack-foot"><span>PHYSICAL NETWORK SIDE</span><span>VIRTUALIZATION ON GH200 · H200 GPU + GRACE CPU</span></div>`, helpers.badge('TARGET ARCHITECTURE')));
});

test('RAN stack template preserves physical/virtual boundary and planning-only status', () => {
  const project = { integration: { vCoreEndpoint: '', vDUEndpoint: '', connected: false } };
  const html = renderStackView(project, helpers);
  assert.match(html, /Physical-to-virtual RAN stack/);
  assert.match(html, /RAN integration not connected/);
  assert.match(html, /vCore/);
  assert.match(html, /vDU/);
  assert.match(html, /O-RAN RU/);
  assert.match(html, /GH200/);
  assert.match(html, /NOT CONNECTED/);
  assert.match(html, /PLANNED/);
  assert.match(html, /data-field="integration.vCoreEndpoint"/);
  assert.match(html, /data-field="integration.vDUEndpoint"/);
  assert.match(renderArchitectureStrip(helpers), /TARGET ARCHITECTURE/);
});

test('RAN stack fields escape user endpoint labels and never imply a connection', () => {
  const project = { integration: { vCoreEndpoint: 'core"><script>', vDUEndpoint: 'du & lab', connected: false } };
  const html = renderStackView(project, helpers);
  assert.match(html, /core&quot;&gt;&lt;script&gt;/);
  assert.match(html, /du &amp; lab/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /never contacts these endpoints/);
});
