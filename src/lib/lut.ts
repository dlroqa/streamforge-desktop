/**
 * 3D LUT (.cube) support.
 *
 * CSS/SVG filters cannot express 3D color lookups, so LUTs run through a
 * WebGL2 stage: the video frame is drawn with a fragment shader that samples
 * a 3D texture built from the .cube file (hardware trilinear interpolation).
 * The compositor draws the processed canvas instead of the raw video.
 */

/** Marker for the recipe comment StreamForge embeds in exported .cube files */
export const LUT_RECIPE_MARK = 'STREAMFORGE_LOOK';

/** Provenance of a LUT exported by StreamForge: the exact filter preset and
 * color-correction values the table was baked from. Kept loosely typed —
 * it round-trips through a file comment and must survive foreign edits. */
export interface LutRecipe {
  filter: string;
  grade: {
    gamma?: number;
    brightness?: number;
    contrast?: number;
    saturation?: number;
    hue?: number;
    opacity?: number;
    multiplyEnabled?: boolean;
    multiplyColor?: string;
    addEnabled?: boolean;
    addColor?: string;
  };
}

export interface ParsedLut {
  name: string;
  size: number;
  /** RGB bytes, red-fastest ordering (matches .cube + 3D texture layout) */
  data: Uint8Array;
  /** Present when the file carries a StreamForge crafting recipe */
  recipe?: LutRecipe;
}

/** Parse a .cube 3D LUT file. Throws with a readable message on bad input. */
export function parseCubeLut(text: string, fileName: string): ParsedLut {
  let size = 0;
  let name = fileName.replace(/\.cube$/i, '');
  let recipe: LutRecipe | undefined;
  const values: number[] = [];

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith('#')) {
      const at = line.indexOf(LUT_RECIPE_MARK);
      if (at >= 0) {
        try {
          const parsed = JSON.parse(line.slice(at + LUT_RECIPE_MARK.length).trim());
          if (parsed && typeof parsed.filter === 'string' && parsed.grade && typeof parsed.grade === 'object') {
            recipe = parsed as LutRecipe;
          }
        } catch { /* malformed recipe comment — treat as a plain comment */ }
      }
      continue;
    }

    const upper = line.toUpperCase();
    if (upper.startsWith('TITLE')) {
      const m = line.match(/"(.*)"/);
      if (m?.[1]) name = m[1];
      continue;
    }
    if (upper.startsWith('LUT_1D_SIZE')) {
      throw new Error('1D LUTs are not supported — use a 3D .cube LUT');
    }
    if (upper.startsWith('LUT_3D_SIZE')) {
      size = parseInt(line.split(/\s+/)[1], 10);
      continue;
    }
    if (upper.startsWith('DOMAIN_MIN') || upper.startsWith('DOMAIN_MAX') || upper.startsWith('LUT_3D_INPUT_RANGE')) {
      continue; // assume standard 0–1 domain
    }

    const parts = line.split(/\s+/);
    if (parts.length === 3) {
      const r = parseFloat(parts[0]);
      const g = parseFloat(parts[1]);
      const b = parseFloat(parts[2]);
      if (!Number.isNaN(r) && !Number.isNaN(g) && !Number.isNaN(b)) {
        values.push(r, g, b);
      }
    }
  }

  if (!size || size < 2 || size > 128) {
    throw new Error('Missing or invalid LUT_3D_SIZE — is this a 3D .cube file?');
  }
  const expected = size * size * size * 3;
  if (values.length !== expected) {
    throw new Error(`LUT data mismatch: expected ${expected / 3} entries, found ${values.length / 3}`);
  }

  const data = new Uint8Array(expected);
  let maxV = 0;
  for (let i = 0; i < expected; i++) {
    data[i] = Math.max(0, Math.min(255, Math.round(values[i] * 255)));
    maxV = Math.max(maxV, data[i]);
  }
  // A LUT that maps every color to (near-)black would blank the video —
  // almost certainly a broken export, never a real creative grade
  if (maxV < 8) {
    throw new Error('This LUT maps every color to black (a broken export?) — re-export or pick a different .cube');
  }
  return { name, size, data, recipe };
}

const VERT = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  // Flip Y: video frames are Y-down, GL is Y-up
  vUv.y = 1.0 - vUv.y;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const FRAG = `#version 300 es
precision highp float;
precision highp sampler3D;
uniform sampler2D uFrame;
uniform sampler3D uLut;
uniform float uSize;
in vec2 vUv;
out vec4 outColor;
void main() {
  vec4 c = texture(uFrame, vUv);
  vec3 g = clamp(c.rgb, 0.0, 1.0);
  // Half-texel offset so 0 and 1 hit the LUT's outer entries exactly
  vec3 coord = (g * (uSize - 1.0) + 0.5) / uSize;
  outColor = vec4(texture(uLut, coord).rgb, c.a);
}`;

/** WebGL2 processor: feed it video frames, get LUT-graded frames back. */
export class LutRenderer {
  private canvas: HTMLCanvasElement;
  private gl: WebGL2RenderingContext;
  private program: WebGLProgram;
  private frameTex: WebGLTexture;
  private lutTex: WebGLTexture;
  private sizeLoc: WebGLUniformLocation | null;
  private lutSize = 0;
  private lutData: Uint8Array | null = null;

  constructor() {
    this.canvas = document.createElement('canvas');
    const gl = this.canvas.getContext('webgl2', { premultipliedAlpha: false });
    if (!gl) throw new Error('WebGL2 is not available in this browser');
    this.gl = gl;

    const compile = (type: number, src: string): WebGLShader => {
      const shader = gl.createShader(type)!;
      gl.shaderSource(shader, src);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        throw new Error(`LUT shader error: ${gl.getShaderInfoLog(shader)}`);
      }
      return shader;
    };

    const program = gl.createProgram()!;
    gl.attachShader(program, compile(gl.VERTEX_SHADER, VERT));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(`LUT program link error: ${gl.getProgramInfoLog(program)}`);
    }
    this.program = program;
    gl.useProgram(program);

    // Fullscreen quad
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(program, 'aPos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    this.frameTex = gl.createTexture()!;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.frameTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    this.lutTex = gl.createTexture()!;

    gl.uniform1i(gl.getUniformLocation(program, 'uFrame'), 0);
    gl.uniform1i(gl.getUniformLocation(program, 'uLut'), 1);
    this.sizeLoc = gl.getUniformLocation(program, 'uSize');
  }

  setLut(lut: ParsedLut) {
    const { gl } = this;
    // Upload as 4-channel: 3-channel 3D textures hit driver bugs (ANGLE on
    // macOS samples them as black) and row-alignment quirks; RGBA8 works
    // everywhere. An incomplete/failed texture samples as black in WebGL2,
    // so a silent upload error here blacks out the whole frame — check it.
    const texels = lut.size ** 3;
    const rgba = new Uint8Array(texels * 4);
    for (let i = 0; i < texels; i++) {
      rgba[i * 4] = lut.data[i * 3];
      rgba[i * 4 + 1] = lut.data[i * 3 + 1];
      rgba[i * 4 + 2] = lut.data[i * 3 + 2];
      rgba[i * 4 + 3] = 255;
    }
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_3D, this.lutTex);
    gl.texImage3D(
      gl.TEXTURE_3D, 0, gl.RGBA8,
      lut.size, lut.size, lut.size, 0,
      gl.RGBA, gl.UNSIGNED_BYTE, rgba,
    );
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
    const err = gl.getError();
    if (err !== gl.NO_ERROR) {
      throw new Error(`LUT texture upload failed (GL error 0x${err.toString(16)})`);
    }
    this.lutSize = lut.size;
    this.lutData = lut.data;
  }

  /** Render a mid-gray probe and read it back — catches drivers that
   * silently sample the 3D texture as black (which would blank the video)
   * without raising any GL error. Call after setLut. */
  selfTest(): boolean {
    const probe = document.createElement('canvas');
    probe.width = 2;
    probe.height = 2;
    const pctx = probe.getContext('2d');
    if (!pctx) return true; // can't probe — assume OK rather than block
    pctx.fillStyle = 'rgb(128,128,128)';
    pctx.fillRect(0, 0, 2, 2);
    this.process(probe, 2, 2);
    const px = new Uint8Array(4);
    this.gl.readPixels(0, 0, 1, 1, this.gl.RGBA, this.gl.UNSIGNED_BYTE, px);
    if (px[0] + px[1] + px[2] > 0) return true;
    // Black output is only credible if the LUT really maps mid-gray to black
    const s = this.lutSize;
    const m = Math.floor(s / 2);
    const i = ((m * s + m) * s + m) * 3;
    const d = this.lutData;
    return !!d && d[i] + d[i + 1] + d[i + 2] < 24;
  }

  /** Apply the LUT to a frame source; returns the processed canvas. */
  process(source: TexImageSource, width: number, height: number): HTMLCanvasElement {
    const { gl } = this;
    if (gl.isContextLost()) throw new Error('WebGL context lost');
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    gl.viewport(0, 0, width, height);
    gl.useProgram(this.program);
    gl.uniform1f(this.sizeLoc, this.lutSize);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.frameTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_3D, this.lutTex);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    return this.canvas;
  }

  dispose() {
    const ext = this.gl.getExtension('WEBGL_lose_context');
    ext?.loseContext();
  }
}
