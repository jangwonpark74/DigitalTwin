import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { parseGeoJsonScene } from '../../../scene.mjs';
import { createWorkspaceState } from '../../../workspaces.mjs';
import { workspaceSchema } from '../../api/schemas';
import { buildMissionMapModel } from './missionMapModel';
import MissionControlMap from './MissionControlMap';

const record = () => workspaceSchema.parse(createWorkspaceState(undefined, {
  id: '11111111-1111-4111-8111-111111111111', now: () => '2026-01-01T00:00:00Z',
})).projects[0];

describe('Mission Control map and selected-site presentation (not yet routed)', () => {
  it('renders a truthful schematic with a keyboard-operable map marker and textual site alternative', async () => {
    const user = userEvent.setup();
    const selected = record();
    const onSelect = vi.fn();
    const onNavigate = vi.fn();
    const { rerender, container } = render(<MissionControlMap model={buildMissionMapModel(selected)} onSelect={onSelect} onNavigate={onNavigate} />);
    expect(screen.getByText('Schematic preview · no imported geometry')).toBeTruthy();
    expect(screen.getByText(/Illustration only; not RT output/)).toBeTruthy();
    const map = screen.getByRole('group', { name: 'Schematic city map with selectable 5G sites' });
    expect(within(map).getAllByRole('button')).toHaveLength(3);
    expect(container.querySelectorAll('[data-sector]')).toHaveLength(9);
    const marker = within(map).getByRole('button', { name: 'Select River Bridge site on map' });
    marker.focus();
    fireEvent.keyDown(marker, { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledWith('SITE-02');
    fireEvent.keyDown(marker, { key: ' ' });
    expect(onSelect).toHaveBeenCalledTimes(2);
    rerender(<MissionControlMap model={buildMissionMapModel(selected, 'SITE-02')} onSelect={onSelect} onNavigate={onNavigate} />);
    expect(screen.getByRole('region', { name: 'Selected site' }).textContent).toContain('River Bridge');
    expect(screen.getByRole('button', { name: 'River Bridge in site list' }).getAttribute('aria-pressed')).toBe('true');
    await user.click(screen.getByRole('button', { name: 'Market Street in site list' }));
    expect(onSelect).toHaveBeenCalledWith('SITE-03');
    await user.click(screen.getByRole('button', { name: /Configure radio location/i }));
    await user.click(screen.getByRole('button', { name: /Configure site & cells/i }));
    expect(onNavigate.mock.calls).toEqual([['radio'], ['planner']]);
    expect(container.querySelector('polygon')).toBeNull();
    const other = structuredClone(selected);
    other.id = '22222222-2222-4222-8222-222222222222';
    (other.project.sites as { name: string }[])[0].name = 'Other pilot site';
    rerender(<MissionControlMap model={buildMissionMapModel(other, 'SITE-99')} onSelect={onSelect} onNavigate={onNavigate} />);
    expect(screen.getByRole('region', { name: 'Selected site' }).textContent).toContain('Other pilot site');
    expect(screen.getByRole('button', { name: 'Other pilot site in site list' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('shows actual GeoJSON provenance, renders imported polygons, and keeps off-map sites in the list', () => {
    const selected = record();
    (selected.project.map as { scene: unknown }).scene = parseGeoJsonScene({
      type: 'FeatureCollection', features: [{ type: 'Feature', id: 'building-1', properties: { height: '24 m' },
        geometry: { type: 'Polygon', coordinates: [[
          [126.9778, 37.5664], [126.9780, 37.5664], [126.9780, 37.5666],
          [126.9778, 37.5666], [126.9778, 37.5664],
        ]] } }],
    }, { fileName: 'verified-input.geojson', importedAt: '2026-01-01T00:00:00Z' });
    const firstSite = (selected.project.sites as { radioLocation: { latitude: number | null; longitude: number | null; source: string } }[])[0];
    firstSite.radioLocation = { latitude: 37.7, longitude: 126.978, source: 'manual' };
    const { container } = render(<MissionControlMap model={buildMissionMapModel(selected)} onSelect={vi.fn()} onNavigate={vi.fn()} />);
    expect(screen.getByText(/verified-input.geojson · WGS84 EPSG:4326/)).toBeTruthy();
    expect(screen.getByText('LOCAL GEOJSON')).toBeTruthy();
    expect(container.querySelectorAll('polygon')).toHaveLength(1);
    expect(container.querySelector('polygon title')?.textContent).toContain('building-1 · 24 m');
    expect(within(screen.getByRole('group', { name: 'Loaded GeoJSON footprint map with selectable 5G sites' }))
      .queryByRole('button', { name: 'Select Civic Square site on map' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Civic Square in site list' })).toBeTruthy();
    expect(screen.getByText('Real vDU · unverified')).toBeTruthy();
  });

  it('keeps map layers transient and truthful without removing the textual site alternative', () => {
    const selected = record();
    const before = structuredClone(selected);
    const onToggleLayer = vi.fn();
    const layers = { buildings: true, sectors: true, ues: true };
    const { container, rerender } = render(<MissionControlMap model={buildMissionMapModel(selected)}
      onSelect={vi.fn()} onNavigate={vi.fn()} layers={layers} onToggleLayer={onToggleLayer} />);
    expect(container.querySelectorAll('[data-demo-building]')).toHaveLength(58);
    expect(container.querySelectorAll('[data-sector]')).toHaveLength(9);
    expect(container.querySelectorAll('[data-ue-sample]')).toHaveLength(88);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Buildings' }));
    expect(onToggleLayer).toHaveBeenCalledWith('buildings', false);
    rerender(<MissionControlMap model={buildMissionMapModel(selected)} onSelect={vi.fn()} onNavigate={vi.fn()}
      layers={{ buildings: false, sectors: false, ues: false }} onToggleLayer={onToggleLayer} />);
    expect(container.querySelectorAll('[data-demo-building], [data-sector], [data-ue-sample]')).toHaveLength(0);
    expect(screen.getByText(/UE MARKERS 0 SAMPLE/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Civic Square in site list' })).toBeTruthy();
    expect(selected).toEqual(before);

    (selected.project.map as { scene: unknown }).scene = parseGeoJsonScene({
      type: 'FeatureCollection', features: [{ type: 'Feature', id: 'building-1', properties: { height: 24 },
        geometry: { type: 'Polygon', coordinates: [[
          [126.9778, 37.5664], [126.9780, 37.5664], [126.9780, 37.5666],
          [126.9778, 37.5666], [126.9778, 37.5664],
        ]] } }],
    }, { fileName: 'local.geojson', importedAt: '2026-01-01T00:00:00Z' });
    rerender(<MissionControlMap model={buildMissionMapModel(selected)} onSelect={vi.fn()} onNavigate={vi.fn()}
      layers={{ buildings: false, sectors: false, ues: false }} onToggleLayer={onToggleLayer} />);
    expect(container.querySelector('polygon')).toBeNull();
    expect(screen.getByText('LOCAL GEOJSON')).toBeTruthy();
  });

  it('places a radio from a schematic map click or keyboard-entered coordinates and keeps markers selectable', async () => {
    const user = userEvent.setup();
    const selected = record();
    const onSelect = vi.fn();
    const onPlace = vi.fn();
    const onCancel = vi.fn();
    const placement = { siteId: 'SITE-02', onPlace, onCancel };
    const { container } = render(<MissionControlMap model={buildMissionMapModel(selected, 'SITE-02')}
      onSelect={onSelect} onNavigate={vi.fn()} placement={placement} />);
    const map = screen.getByRole('group', { name: /click the schematic map to place SITE-02/i });
    Object.defineProperty(map, 'getBoundingClientRect', { value: () => ({
      left: 10, top: 20, width: 900, height: 540, right: 910, bottom: 560, x: 10, y: 20,
      toJSON: () => ({}),
    }) });
    fireEvent.click(map, { clientX: 460, clientY: 290 });
    expect(onPlace).toHaveBeenCalledWith({ x: 50, y: 50 });

    onPlace.mockClear();
    await user.clear(screen.getByRole('spinbutton', { name: 'Map X position (%)' }));
    await user.type(screen.getByRole('spinbutton', { name: 'Map X position (%)' }), '35');
    await user.clear(screen.getByRole('spinbutton', { name: 'Map Y position (%)' }));
    await user.type(screen.getByRole('spinbutton', { name: 'Map Y position (%)' }), '72');
    await user.click(screen.getByRole('button', { name: 'Place radio at these coordinates' }));
    expect(onPlace).toHaveBeenCalledWith({ x: 35, y: 72 });

    await user.click(screen.getByRole('button', { name: 'Cancel map placement' }));
    expect(onCancel).toHaveBeenCalledOnce();
    const marker = container.querySelector<SVGGElement>('[aria-label="Select River Bridge site on map"]')!;
    fireEvent.click(marker);
    expect(onSelect).toHaveBeenCalledWith('SITE-02');
    expect(onPlace).toHaveBeenCalledTimes(1);
    expect(selected.project.sites).toHaveLength(3);
  });

  it('handles missing/invalid models and treats site labels as text rather than markup', () => {
    const { rerender, container } = render(<MissionControlMap model={buildMissionMapModel(null)} onSelect={vi.fn()} onNavigate={vi.fn()} />);
    expect(screen.getByRole('status').textContent).toContain('No active project');
    const invalid = record();
    (invalid.project.ue as { count: number }).count = 0;
    rerender(<MissionControlMap model={buildMissionMapModel(invalid)} onSelect={vi.fn()} onNavigate={vi.fn()} />);
    expect(screen.getByRole('alert').textContent).toContain('Invalid UE count');
    const selected = record();
    (selected.project.sites as { name: string }[])[0].name = '<img src=x onerror=alert(1)>';
    rerender(<MissionControlMap model={buildMissionMapModel(selected)} onSelect={vi.fn()} onNavigate={vi.fn()} />);
    expect(screen.getByRole('button', { name: '<img src=x onerror=alert(1)> in site list' })).toBeTruthy();
    expect(container.querySelector('img')).toBeNull();
  });
});
