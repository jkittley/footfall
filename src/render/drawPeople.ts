import type { Camera } from "./camera";
import { Journey, Mode, type PeopleStore } from "../sim/people";

const FLOOR = "#F8F6F2";
const COLOURS = ["#2F6FDB", "#E8772E", "#7B5CD6", "#E5B72A"]; // indexed by Mode: train, subway, flight, street
const STROKE_PX = 2;
const GROUPS = 12; // mode * 3 + journey
const CIRCLE_R = 5;
const CIRCLE_SEGMENTS = 16;
/** Nominal radius per mode, used to turn a 1px stroke offset into a scale. */
const NOMINAL_R = [5, 6, 6, 5.5];

type Pt = readonly [number, number];

const POLYS: Record<Mode, readonly Pt[]> = {
  [Mode.Train]: Array.from({ length: CIRCLE_SEGMENTS }, (_, k): Pt => [
    CIRCLE_R * Math.cos((k * 2 * Math.PI) / CIRCLE_SEGMENTS),
    CIRCLE_R * Math.sin((k * 2 * Math.PI) / CIRCLE_SEGMENTS),
  ]),
  [Mode.Subway]: [[0, -5.5], [6, 5.5], [-6, 5.5]],
  [Mode.Flight]: [0, 1, 2, 3, 4, 5].map((k): Pt => [6 * Math.cos((k * Math.PI) / 3), 6 * Math.sin((k * Math.PI) / 3)]),
  [Mode.Street]: [[0, -5.5], [5.5, 0], [0, 5.5], [-5.5, 0]],
};

/** Sutherland-Hodgman clip of a convex polygon to x <= 0. */
function leftHalf(poly: readonly Pt[]): Pt[] {
  const out: Pt[] = [];
  for (let k = 0; k < poly.length; k++) {
    const a = poly[k]!;
    const b = poly[(k + 1) % poly.length]!;
    const aIn = a[0] <= 0;
    const bIn = b[0] <= 0;
    if (aIn) out.push(a);
    if (aIn !== bIn) out.push([0, a[1] + ((b[1] - a[1]) * (0 - a[0])) / (b[0] - a[0])]);
  }
  return out;
}

/** Triangle fan around the origin (every shape is convex and contains it). */
function fan(poly: readonly Pt[], out: number[]): void {
  for (let k = 0; k < poly.length; k++) {
    const a = poly[k]!;
    const b = poly[(k + 1) % poly.length]!;
    out.push(0, 0, a[0], a[1], b[0], b[1]);
  }
}

function hex(h: string): [number, number, number] {
  return [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];
}

const VERT = `#version 300 es
in vec2 a_v;
in vec2 a_pos;
uniform vec2 u_origin;
uniform float u_tilePx;
uniform float u_k;
uniform vec2 u_view;
void main() {
  vec2 px = u_origin + a_pos * u_tilePx + a_v * u_k;
  gl_Position = vec4(px.x / u_view.x * 2.0 - 1.0, 1.0 - px.y / u_view.y * 2.0, 0.0, 1.0);
}`;
const FRAG = `#version 300 es
precision mediump float;
uniform vec3 u_colour;
out vec4 o;
void main() { o = vec4(u_colour, 1.0); }`;

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const s = gl.createShader(type);
  if (!s) throw new Error("createShader failed");
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(`shader: ${gl.getShaderInfoLog(s)}`);
  return s;
}

/**
 * Instanced WebGL2 renderer for people: one draw call per (shape, fill) pass, per-instance world position.
 * Self-contained: owns an offscreen WebGL canvas that drawPeople blits onto the caller's 2D canvas.
 */
class PeopleRenderer {
  readonly canvas = document.createElement("canvas");
  private readonly gl: WebGL2RenderingContext;
  private readonly prog: WebGLProgram;
  private readonly loc: Record<"origin" | "tilePx" | "k" | "view" | "colour", WebGLUniformLocation | null>;
  private readonly geomBuf: WebGLBuffer;
  private readonly instBuf: WebGLBuffer;
  private readonly vao: WebGLVertexArrayObject;
  private readonly aPos: number;
  /** Per mode: [fullStart, fullCount, halfStart, halfCount] in vertices. */
  private readonly ranges: number[][] = [];
  private inst = new Float32Array(0);
  private readonly colours = COLOURS.map(hex);
  private readonly floor = hex(FLOOR);
  private readonly counts = new Int32Array(GROUPS);
  private readonly starts = new Int32Array(GROUPS);
  private readonly cursor = new Int32Array(GROUPS);

  constructor() {
    const gl = this.canvas.getContext("webgl2", { antialias: true, alpha: true, premultipliedAlpha: true });
    if (!gl) throw new Error("WebGL2 is not available");
    this.gl = gl;
    const prog = gl.createProgram();
    if (!prog) throw new Error("createProgram failed");
    gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(`link: ${gl.getProgramInfoLog(prog)}`);
    this.prog = prog;
    this.loc = {
      origin: gl.getUniformLocation(prog, "u_origin"),
      tilePx: gl.getUniformLocation(prog, "u_tilePx"),
      k: gl.getUniformLocation(prog, "u_k"),
      view: gl.getUniformLocation(prog, "u_view"),
      colour: gl.getUniformLocation(prog, "u_colour"),
    };

    const verts: number[] = [];
    for (let m = 0; m < 4; m++) {
      const poly = POLYS[m as Mode];
      const fullStart = verts.length / 2;
      fan(poly, verts);
      const halfStart = verts.length / 2;
      fan(leftHalf(poly), verts);
      this.ranges.push([fullStart, halfStart - fullStart, halfStart, verts.length / 2 - halfStart]);
    }
    const geomBuf = gl.createBuffer();
    const instBuf = gl.createBuffer();
    const vao = gl.createVertexArray();
    if (!geomBuf || !instBuf || !vao) throw new Error("buffer allocation failed");
    this.geomBuf = geomBuf;
    this.instBuf = instBuf;
    this.vao = vao;
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, geomBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(verts), gl.STATIC_DRAW);
    const aV = gl.getAttribLocation(prog, "a_v");
    gl.enableVertexAttribArray(aV);
    gl.vertexAttribPointer(aV, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, instBuf);
    const aPos = gl.getAttribLocation(prog, "a_pos");
    this.aPos = aPos;
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribDivisor(aPos, 1);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  }

  draw(ctx: CanvasRenderingContext2D, cam: Camera, people: PeopleStore): void {
    const gl = this.gl;
    const dpr = ctx.getTransform().a || 1;
    const pw = ctx.canvas.width;
    const ph = ctx.canvas.height;
    if (this.canvas.width !== pw || this.canvas.height !== ph) {
      this.canvas.width = pw;
      this.canvas.height = ph;
    }
    this.pack(people);

    gl.viewport(0, 0, pw, ph);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.prog);
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instBuf);
    gl.bufferData(gl.ARRAY_BUFFER, this.inst.subarray(0, people.count * 2), gl.STREAM_DRAW);

    const [ox, oy] = cam.worldToScreen(0, 0);
    gl.uniform2f(this.loc.origin, ox, oy);
    gl.uniform1f(this.loc.tilePx, cam.worldToScreen(1, 0)[0] - ox);
    gl.uniform2f(this.loc.view, pw / dpr, ph / dpr);

    const k = cam.zoom;
    const half = STROKE_PX / 2;
    for (let m = 0; m < 4; m++) {
      const [fs, fc, hs, hc] = this.ranges[m]!;
      const colour = this.colours[m]!;
      const outer = k + half / NOMINAL_R[m]!;
      const inner = Math.max(0, k - half / NOMINAL_R[m]!);
      for (let j = 0; j < 3; j++) {
        const g = m * 3 + j;
        const n = this.counts[g]!;
        if (n === 0) continue;
        gl.vertexAttribPointer(this.aPos, 2, gl.FLOAT, false, 0, this.starts[g]! * 8);
        if (j === Journey.Departing) {
          this.pass(colour, k, fs!, fc!, n);
        } else {
          this.pass(colour, outer, fs!, fc!, n);
          this.pass(this.floor, inner, fs!, fc!, n);
          if (j === Journey.Connecting) this.pass(colour, inner, hs!, hc!, n);
        }
      }
    }

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.canvas, 0, 0);
    ctx.restore();
  }

  private pass(colour: readonly number[], k: number, first: number, count: number, instances: number): void {
    const gl = this.gl;
    gl.uniform3f(this.loc.colour, colour[0]!, colour[1]!, colour[2]!);
    gl.uniform1f(this.loc.k, k);
    gl.drawArraysInstanced(gl.TRIANGLES, first, count, instances);
  }

  /** Groups positions by (mode, journey) into one instance buffer. */
  private pack(people: PeopleStore): void {
    const { x, y, mode, journey } = people;
    const end = people.end;
    if (this.inst.length < people.cap * 2) this.inst = new Float32Array(people.cap * 2);
    this.counts.fill(0);
    for (let i = 0; i < end; i++) if (people.isAlive(i)) this.counts[mode[i]! * 3 + journey[i]!]!++;
    let acc = 0;
    for (let g = 0; g < GROUPS; g++) {
      this.starts[g] = acc;
      this.cursor[g] = acc;
      acc += this.counts[g]!;
    }
    const inst = this.inst;
    for (let i = 0; i < end; i++) {
      if (!people.isAlive(i)) continue;
      const g = mode[i]! * 3 + journey[i]!;
      const c = this.cursor[g]!++;
      inst[c * 2] = x[i]!;
      inst[c * 2 + 1] = y[i]!;
    }
  }
}

let renderer: PeopleRenderer | null = null;

/** Draws every person as its mode's shape and colour; fill is solid (departing), outline (arriving) or half (connecting). */
export function drawPeople(ctx: CanvasRenderingContext2D, cam: Camera, people: PeopleStore): void {
  renderer ??= new PeopleRenderer();
  renderer.draw(ctx, cam, people);
}
