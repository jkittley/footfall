import type { Camera } from "./camera";
import { Journey, Mode, type PeopleStore } from "../sim/people";
import { drawPeople2d } from "./drawPeople2d";
import { FLOOR, MODE_COLOURS, hexToUnit } from "./palette";
import { fan, inset, leftHalf, POLYS, RING_PX } from "./shapes";
import { tryCreate } from "./rendererChoice";

const MODES = [Mode.Train, Mode.Subway, Mode.Flight, Mode.Street] as const;
const GROUPS = 12; // mode * 3 + journey

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
  private prog!: WebGLProgram;
  private loc!: Record<"origin" | "tilePx" | "k" | "view" | "colour", WebGLUniformLocation | null>;
  private instBuf!: WebGLBuffer;
  private vao!: WebGLVertexArrayObject;
  private aPos = 0;
  /** True between webglcontextlost and webglcontextrestored. */
  lost = false;
  /** Per mode: [fullStart, fullCount, innerStart, innerCount, halfStart, halfCount] in vertices. */
  private ranges: number[][] = [];
  private inst = new Float32Array(0);
  private readonly colours = MODES.map((m) => hexToUnit(MODE_COLOURS[m]));
  private readonly floor = hexToUnit(FLOOR);
  private readonly counts = new Int32Array(GROUPS);
  private readonly starts = new Int32Array(GROUPS);
  private readonly cursor = new Int32Array(GROUPS);
  /** Instances in the packed buffer: the sum of the group counts. */
  private packed = 0;

  constructor() {
    const gl = this.canvas.getContext("webgl2", { antialias: true, alpha: true, premultipliedAlpha: true });
    if (!gl) throw new Error("WebGL2 is not available");
    this.gl = gl;
    this.canvas.addEventListener("webglcontextlost", (e) => {
      e.preventDefault();
      this.lost = true;
    });
    this.canvas.addEventListener("webglcontextrestored", () => {
      this.init();
      this.lost = false;
    });
    this.init();
  }

  /** Builds every GL resource; runs again after a context restore. */
  private init(): void {
    const gl = this.gl;
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
    this.ranges = [];
    for (let m = 0; m < 4; m++) {
      const poly = POLYS[m as keyof typeof POLYS];
      const fullStart = verts.length / 2;
      fan(poly, verts);
      const innerStart = verts.length / 2;
      fan(inset(poly, RING_PX), verts);
      const halfStart = verts.length / 2;
      fan(leftHalf(poly), verts);
      const end = verts.length / 2;
      this.ranges.push([fullStart, innerStart - fullStart, innerStart, halfStart - innerStart, halfStart, end - halfStart]);
    }
    const geomBuf = gl.createBuffer();
    const instBuf = gl.createBuffer();
    const vao = gl.createVertexArray();
    if (!geomBuf || !instBuf || !vao) throw new Error("buffer allocation failed");
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

  /** Returns false (drawing nothing) while the GL context is lost. */
  draw(ctx: CanvasRenderingContext2D, cam: Camera, people: PeopleStore, dpr: number): boolean {
    if (this.lost) return false;
    const gl = this.gl;
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
    gl.bufferData(gl.ARRAY_BUFFER, this.inst.subarray(0, this.packed * 2), gl.STREAM_DRAW);

    const [ox, oy] = cam.worldToScreen(0, 0);
    gl.uniform2f(this.loc.origin, ox, oy);
    gl.uniform1f(this.loc.tilePx, cam.worldToScreen(1, 0)[0] - ox);
    gl.uniform2f(this.loc.view, pw / dpr, ph / dpr);

    const k = cam.zoom;
    for (let m = 0; m < 4; m++) {
      const [fs, fc, is, ic, hs, hc] = this.ranges[m]!;
      const colour = this.colours[m]!;
      for (let j = 0; j < 3; j++) {
        const g = m * 3 + j;
        const n = this.counts[g]!;
        if (n === 0) continue;
        gl.vertexAttribPointer(this.aPos, 2, gl.FLOAT, false, 0, this.starts[g]! * 8);
        if (j === Journey.Departing) {
          this.pass(colour, k, fs!, fc!, n);
        } else {
          this.pass(colour, k, fs!, fc!, n);
          this.pass(this.floor, k, is!, ic!, n);
          if (j === Journey.Connecting) this.pass(colour, k, hs!, hc!, n);
        }
      }
    }

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.canvas, 0, 0);
    ctx.restore();
    return true;
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
    this.packed = acc;
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
let triedGl = false;

/**
 * Draws every person as its mode's shape and colour; fill is solid (departing), outline (arriving)
 * or half (connecting). Falls back to Canvas 2D when WebGL2 is unavailable or its context is lost.
 *
 * Contract: `ctx` belongs to a canvas covering the whole view, whose backing store is `dpr` device
 * px per CSS px; the camera maps world tiles to CSS px. The incoming transform is ignored (both
 * paths set their own), so a caller's translation or scale never shifts people off the plan.
 */
export function drawPeople(ctx: CanvasRenderingContext2D, cam: Camera, people: PeopleStore, dpr: number): void {
  if (!triedGl) {
    triedGl = true;
    renderer = tryCreate(() => new PeopleRenderer(), (msg, e) => console.warn(msg, e));
  }
  if (renderer?.draw(ctx, cam, people, dpr)) return;
  drawPeople2d(ctx, cam, people, dpr);
}
