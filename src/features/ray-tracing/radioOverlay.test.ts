import { describe, expect, it, vi } from 'vitest';
import { MercatorCoordinate, type CustomRenderMethodInput, type Map } from 'maplibre-gl';
import { createRadioOverlay } from './radioOverlay';

describe('elevated radio overlay', () => {
  it('uploads altitude in meters and picks the elevated screen position rather than its ground location', () => {
    const canvas = { clientWidth: 800, clientHeight: 600 };
    const bufferData = vi.fn();
    const methods: Record<string, unknown> = { bufferData, createShader: () => ({}), createProgram: () => ({}),
      createBuffer: () => ({}), getShaderParameter: () => true, getProgramParameter: () => true,
      getAttribLocation: () => 0 };
    const gl = new Proxy(methods, { get: (target, key) => target[String(key)] ?? (String(key) === String(key).toUpperCase() ? 1 : vi.fn()) }) as unknown as WebGLRenderingContext;
    const origin: [number, number] = [127.0346, 37.5058];
    const dot = { point: { longitude: origin[0], latitude: origin[1], heightM: 1.5 }, index: 17,
      color: '#15956f', radius: 5.5, border: 1.5 };
    let visible = true;
    const overlay = createRadioOverlay(MercatorCoordinate, () => [], () => origin,
      { id: 'drive-kpi-3d', dots: () => visible ? [dot] : [] });
    overlay.onAdd!({ getCanvas: () => canvas } as unknown as Map, gl);
    const ground = MercatorCoordinate.fromLngLat(origin);
    const elevated = MercatorCoordinate.fromLngLat(origin, 1.5);
    // A pitched orthographic projection makes the altitude displacement explicit.
    const matrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, -2e6, 1, 0, -ground.x, -ground.y, 0, 1];
    const frame = { defaultProjectionData: { mainMatrix: matrix } } as unknown as CustomRenderMethodInput;
    overlay.render(gl, frame);
    const vertices = bufferData.mock.calls[0][1] as Float32Array;
    expect(vertices[2]).toBeGreaterThan(0);
    expect(vertices[2]).toBeCloseTo(elevated.z, 12);
    expect(new MercatorCoordinate(ground.x, ground.y, vertices[2]).toAltitude()).toBeCloseTo(1.5, 5);
    expect(overlay.pickDot([400, 300 + elevated.z * 2e6 * 300])).toBe(17);
    expect(overlay.pickDot([400, 300])).toBeNull();
    visible = false; overlay.invalidate(); overlay.render(gl, frame);
    expect(overlay.pickDot([400, 300 + elevated.z * 2e6 * 300])).toBeNull();
    overlay.onRemove!({} as Map, gl);
  });
});
