import type { CustomLayerInterface, CustomRenderMethodInput, MercatorCoordinate } from 'maplibre-gl';
import type { GeoPoint } from './propagationGeometry';

export type RadioLine = { points: GeoPoint[]; color: string; width: number };
type GL = WebGLRenderingContext | WebGL2RenderingContext;

// Screen-width ribbons preserve actual WGS84 altitude. Rebase around the map
// origin before float32 upload to retain sub-meter precision at street scale.
export function createRadioOverlay(Coordinate: typeof MercatorCoordinate, lines: () => RadioLine[], origin: () => [number, number]):
  CustomLayerInterface & { invalidate(): void } {
  let program: WebGLProgram | null = null;
  let buffer: WebGLBuffer | null = null;
  let dirty = true;
  let count = 0;
  let center = Coordinate.fromLngLat(origin());
  const shaders: WebGLShader[] = [];
  const compile = (gl: GL, type: number, code: string) => {
    const shader = gl.createShader(type)!;
    shaders.push(shader);
    gl.shaderSource(shader, code); gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? 'Radio shader failed');
    return shader;
  };
  return {
    id: 'rf-paths-3d', type: 'custom', renderingMode: '3d',
    invalidate() { dirty = true; },
    onAdd(_map, gl) {
      try {
        program = gl.createProgram(); buffer = gl.createBuffer();
        gl.attachShader(program!, compile(gl, gl.VERTEX_SHADER, `precision highp float;
          attribute vec3 a_pos; attribute vec3 a_end; attribute float a_side; attribute vec4 a_color;
          uniform mat4 u_matrix; uniform vec2 u_view; varying vec4 v_color;
          void main() { vec4 p = u_matrix * vec4(a_pos, 1.0); vec4 q = u_matrix * vec4(a_end, 1.0);
            vec2 d = (q.xy / q.w - p.xy / p.w) * u_view;
            vec2 n = vec2(-d.y, d.x) / max(length(d), 0.001);
            p.xy += n * a_side / u_view * p.w; gl_Position = p; v_color = a_color; }`));
        gl.attachShader(program!, compile(gl, gl.FRAGMENT_SHADER, `precision mediump float;
          varying vec4 v_color; void main() { gl_FragColor = v_color; }`));
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
            p.x - center.x, p.y - center.y, p.z, q.x - center.x, q.y - center.y, q.z, side * line.width, ...color, 1);
          for (let i = 1; i < points.length; i++) {
            const a = points[i - 1], b = points[i];
            vertex(a, b, -1); vertex(a, b, 1); vertex(b, a, -1);
            vertex(a, b, -1); vertex(b, a, -1); vertex(b, a, 1);
          }
        }
        count = data.length / 11;
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.DYNAMIC_DRAW); dirty = false;
      }
      const matrix = Array.from(args.defaultProjectionData.mainMatrix);
      for (let row = 0; row < 4; row++) matrix[12 + row] += matrix[row] * center.x + matrix[4 + row] * center.y;
      gl.uniformMatrix4fv(gl.getUniformLocation(program, 'u_matrix'), false, matrix);
      gl.uniform2f(gl.getUniformLocation(program, 'u_view'), gl.drawingBufferWidth, gl.drawingBufferHeight);
      for (const [name, size, offset] of [['a_pos', 3, 0], ['a_end', 3, 3], ['a_side', 1, 6], ['a_color', 4, 7]] as const) {
        const attribute = gl.getAttribLocation(program, name); gl.enableVertexAttribArray(attribute);
        gl.vertexAttribPointer(attribute, size, gl.FLOAT, false, 44, offset * 4);
      }
      gl.enable(gl.DEPTH_TEST); gl.depthMask(false); gl.disable(gl.CULL_FACE);
      gl.drawArrays(gl.TRIANGLES, 0, count);
      for (const name of ['a_pos', 'a_end', 'a_side', 'a_color']) gl.disableVertexAttribArray(gl.getAttribLocation(program, name));
      gl.depthMask(true);
    },
    onRemove(_map, gl) { if (buffer) gl.deleteBuffer(buffer); if (program) gl.deleteProgram(program); shaders.forEach(shader => gl.deleteShader(shader)); },
  };
}
