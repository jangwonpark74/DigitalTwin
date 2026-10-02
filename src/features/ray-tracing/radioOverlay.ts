import type { CustomLayerInterface, CustomRenderMethodInput, MercatorCoordinate } from 'maplibre-gl';
import type { GeoPoint } from './propagationGeometry';

export type RadioLine = { points: GeoPoint[]; color: string; width: number };
export type RadioDot = { point: GeoPoint; index: number; color: string; radius: number; border: number };
type GL = WebGLRenderingContext | WebGL2RenderingContext;

// Screen-width ribbons preserve actual WGS84 altitude. Rebase around the map
// origin before float32 upload to retain sub-meter precision at street scale.
export function createRadioOverlay(Coordinate: typeof MercatorCoordinate, lines: () => RadioLine[], origin: () => [number, number],
  options: { id?: string; dots?: () => RadioDot[] } = {}):
  CustomLayerInterface & { invalidate(): void; pickDot(point: [number, number]): number | null } {
  let program: WebGLProgram | null = null;
  let buffer: WebGLBuffer | null = null;
  let dirty = true;
  let count = 0;
  let center = Coordinate.fromLngLat(origin());
  let canvas: HTMLCanvasElement | null = null;
  let dots: { coordinate: MercatorCoordinate; dot: RadioDot }[] = [];
  let projected: { x: number; y: number; dot: RadioDot }[] = [];
  const shaders: WebGLShader[] = [];
  const compile = (gl: GL, type: number, code: string) => {
    const shader = gl.createShader(type)!;
    shaders.push(shader);
    gl.shaderSource(shader, code); gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? 'Radio shader failed');
    return shader;
  };
  return {
    id: options.id ?? 'rf-paths-3d', type: 'custom', renderingMode: '3d',
    invalidate() { dirty = true; projected = []; },
    pickDot([x, y]) {
      let nearest: number | null = null;
      let distance = Infinity;
      for (const point of projected) {
        const next = Math.hypot(point.x - x, point.y - y);
        if (next <= point.dot.radius + 6 && next < distance) { nearest = point.dot.index; distance = next; }
      }
      return nearest;
    },
    onAdd(map, gl) {
      canvas = map.getCanvas();
      try {
        program = gl.createProgram(); buffer = gl.createBuffer();
        gl.attachShader(program!, compile(gl, gl.VERTEX_SHADER, `precision highp float;
          attribute vec3 a_pos; attribute vec3 a_end; attribute float a_side; attribute vec4 a_color;
          attribute vec2 a_offset; attribute float a_inner;
          uniform mat4 u_matrix; uniform vec2 u_view; varying vec4 v_color; varying vec2 v_offset; varying float v_inner;
          void main() { vec4 p = u_matrix * vec4(a_pos, 1.0); vec4 q = u_matrix * vec4(a_end, 1.0);
            vec2 d = (q.xy / q.w - p.xy / p.w) * u_view;
            vec2 n = vec2(-d.y, d.x) / max(length(d), 0.001);
            vec2 offset = a_inner < 0.0 ? n : a_offset;
            p.xy += offset * a_side / u_view * p.w; gl_Position = p; v_color = a_color;
            v_offset = a_offset; v_inner = a_inner; }`));
        gl.attachShader(program!, compile(gl, gl.FRAGMENT_SHADER, `precision mediump float;
          varying vec4 v_color; varying vec2 v_offset; varying float v_inner;
          void main() { float radius = dot(v_offset, v_offset);
            if (v_inner >= 0.0 && radius > 1.0) discard;
            gl_FragColor = v_inner >= 0.0 && radius > v_inner * v_inner ? vec4(1.0) : v_color; }`));
        gl.linkProgram(program!);
        if (!gl.getProgramParameter(program!, gl.LINK_STATUS)) throw new Error('Radio shader could not link');
      } catch (cause) {
        if (buffer) gl.deleteBuffer(buffer); if (program) gl.deleteProgram(program);
        shaders.forEach(shader => gl.deleteShader(shader)); throw cause;
      }
    },
    render(gl: GL, args: CustomRenderMethodInput) {
      if (!program || !buffer) return;
      gl.useProgram(program); gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      if (dirty) {
        center = Coordinate.fromLngLat(origin());
        const data: number[] = [];
        for (const line of lines()) {
          const color = [1, 3, 5].map(index => parseInt(line.color.slice(index, index + 2), 16) / 255);
          const points = line.points.map(point => Coordinate.fromLngLat([point.longitude, point.latitude], point.heightM));
          const vertex = (p: MercatorCoordinate, q: MercatorCoordinate, side: number) => data.push(
            p.x - center.x, p.y - center.y, p.z, q.x - center.x, q.y - center.y, q.z, side * line.width, ...color, 1, 0, 0, -1);
          for (let i = 1; i < points.length; i++) {
            const a = points[i - 1], b = points[i];
            vertex(a, b, -1); vertex(a, b, 1); vertex(b, a, -1);
            vertex(a, b, -1); vertex(b, a, -1); vertex(b, a, 1);
          }
        }
        dots = [...(options.dots?.() ?? [])].sort((a, b) => a.border - b.border).map(dot => ({ dot,
          coordinate: Coordinate.fromLngLat([dot.point.longitude, dot.point.latitude], dot.point.heightM) }));
        for (const { coordinate: p, dot } of dots) {
          const color = [1, 3, 5].map(index => parseInt(dot.color.slice(index, index + 2), 16) / 255);
          for (const [x, y] of [[-1, -1], [1, -1], [1, 1], [-1, -1], [1, 1], [-1, 1]])
            data.push(p.x - center.x, p.y - center.y, p.z, p.x - center.x, p.y - center.y, p.z,
              dot.radius * 2, ...color, 1, x, y, (dot.radius - dot.border) / dot.radius);
        }
        count = data.length / 14;
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.DYNAMIC_DRAW); dirty = false;
      }
      const matrix = Array.from(args.defaultProjectionData.mainMatrix);
      for (let row = 0; row < 4; row++) matrix[12 + row] += matrix[row] * center.x + matrix[4 + row] * center.y;
      gl.uniformMatrix4fv(gl.getUniformLocation(program, 'u_matrix'), false, matrix);
      const width = canvas?.clientWidth || gl.drawingBufferWidth;
      const height = canvas?.clientHeight || gl.drawingBufferHeight;
      gl.uniform2f(gl.getUniformLocation(program, 'u_view'), width, height);
      projected = dots.flatMap(({ coordinate: p, dot }) => {
        const clip = [0, 1, 2, 3].map(row => matrix[row] * (p.x - center.x) + matrix[4 + row] * (p.y - center.y) + matrix[8 + row] * p.z + matrix[12 + row]);
        const x = (clip[0] / clip[3] + 1) * width / 2, y = (1 - clip[1] / clip[3]) * height / 2;
        return clip[3] > 0 && Math.abs(clip[2] / clip[3]) <= 1 && x >= 0 && x <= width && y >= 0 && y <= height ? [{ x, y, dot }] : [];
      });
      const attributes = [['a_pos', 3, 0], ['a_end', 3, 3], ['a_side', 1, 6], ['a_color', 4, 7], ['a_offset', 2, 11], ['a_inner', 1, 13]] as const;
      for (const [name, size, offset] of attributes) {
        const attribute = gl.getAttribLocation(program, name); gl.enableVertexAttribArray(attribute);
        gl.vertexAttribPointer(attribute, size, gl.FLOAT, false, 56, offset * 4);
      }
      gl.enable(gl.DEPTH_TEST); gl.depthMask(false); gl.disable(gl.CULL_FACE);
      gl.drawArrays(gl.TRIANGLES, 0, count);
      for (const [name] of attributes) gl.disableVertexAttribArray(gl.getAttribLocation(program, name));
      gl.depthMask(true);
    },
    onRemove(_map, gl) { projected = []; dots = []; if (buffer) gl.deleteBuffer(buffer); if (program) gl.deleteProgram(program); shaders.forEach(shader => gl.deleteShader(shader)); },
  };
}
