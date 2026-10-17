// Ginkgo 3D view — Taman Sri Muda as an architect's white model: no colour
// on the buildings, only their outlines, like a drawing in 3D. In a flood
// drill the water rises through the streets, with the evacuation route and
// the centres marked. Loaded on demand (three.js is a separate chunk).

import { useEffect, useRef, useState, type FC } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CSS2DObject, CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import type { Grid } from '../data/types';
import type { LonLat } from '../data/analysis';
import { fmtClock, type FloodSim } from '../sim/flood';
import { buildingGeometry, FloodSurface, loadModel3D, ribbonGeometry, toLocal, waterPolygons, type Model3D } from './model3d';

interface Props {
  grid: Grid;
  sim: FloodSim | null;
  t: number;
  route: LonLat[] | null;
  routeShelter: number | null;
  onClose: () => void;
  /** planning mode: start the Klang Valley drill and play it */
  onPlayFlood: (() => void) | null;
}

const PAPER = 0xF3F0E8;
const STREET = 0xFBFAF6;
const RIVER = 0xD3DEE6;
const INK = 0x2E2E2E;
const HOUSE_M = 7; // typical two-storey terrace

interface Scene3D {
  renderer: THREE.WebGLRenderer;
  labels: CSS2DRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  flood: FloodSurface;
  water: THREE.Mesh;
  route: THREE.Group;
  labelGroup: THREE.Group;
  model: Model3D;
  home: () => void;
}

export const Sketch3D: FC<Props> = ({ grid, sim, t, route, routeShelter, onClose, onPlayFlood }) => {
  const box = useRef<HTMLDivElement>(null);
  const three = useRef<Scene3D | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [info, setInfo] = useState<{ buildings: number; estimated: number; note: string; centres: Model3D['meta']['centres'] } | null>(null);
  const [depth, setDepth] = useState<{ max: number; median: number; flooded: number }>({ max: 0, median: 0, flooded: 0 });
  const [showWater, setShowWater] = useState(true);
  const [showLabels, setShowLabels] = useState(true);
  const [spin, setSpin] = useState(false);

  // ── build the scene once ──
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    let alive = true, raf = 0;
    let dispose = () => {};
    loadModel3D().then(model => {
      if (!alive) return;
      const W = el.clientWidth, H = el.clientHeight;
      const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.setSize(W, H);
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      el.appendChild(renderer.domElement);
      const labels = new CSS2DRenderer();
      labels.setSize(W, H);
      labels.domElement.className = 'sketch-labels';
      el.appendChild(labels.domElement);

      const scene = new THREE.Scene();
      scene.background = new THREE.Color(PAPER);
      scene.fog = new THREE.Fog(PAPER, 5500, 11000);
      const camera = new THREE.PerspectiveCamera(32, W / H, 5, 30000);

      scene.add(new THREE.HemisphereLight(0xFFFFFF, 0xD9D4C8, 1.25));
      const sun = new THREE.DirectionalLight(0xFFFFFF, 1.5);
      sun.position.set(-2200, 3600, -1400);
      sun.castShadow = true;
      sun.shadow.mapSize.set(4096, 4096);
      Object.assign(sun.shadow.camera, { left: -3600, right: 3600, top: 3600, bottom: -3600, near: 100, far: 9000 });
      sun.shadow.bias = -0.0004;
      sun.shadow.normalBias = 0.6;
      scene.add(sun);

      const ground = new THREE.Mesh(new THREE.PlaneGeometry(16000, 16000), new THREE.MeshLambertMaterial({ color: 0xECE8DE }));
      ground.rotation.x = -Math.PI / 2;
      ground.receiveShadow = true;
      scene.add(ground);
      const streets = new THREE.Mesh(
        ribbonGeometry(model, 'road_counts', 'road_xy', 'road_class', model.meta.road_width_m, 0.08),
        new THREE.MeshLambertMaterial({ color: STREET }));
      streets.receiveShadow = true;
      scene.add(streets);
      const waterMat = new THREE.MeshLambertMaterial({ color: RIVER });
      const rivers = new THREE.Mesh(ribbonGeometry(model, 'river_counts', 'river_xy', 'river_class', model.meta.river_width_m, 0.12), waterMat);
      const ponds = new THREE.Mesh(waterPolygons(model, 0.1), waterMat);
      rivers.receiveShadow = ponds.receiveShadow = true;
      scene.add(rivers, ponds);

      const { mesh, edges } = buildingGeometry(model);
      const houses = new THREE.Mesh(mesh, new THREE.MeshLambertMaterial({ color: 0xFFFFFF, side: THREE.DoubleSide }));
      houses.castShadow = houses.receiveShadow = true;
      scene.add(houses);
      scene.add(new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: INK, transparent: true, opacity: 0.55 })));

      const flood = new FloodSurface(model, grid);
      const water = new THREE.Mesh(flood.geometry, new THREE.MeshLambertMaterial({
        color: 0x5E9FE0, transparent: true, opacity: 0.62, depthWrite: false, side: THREE.DoubleSide,
      }));
      water.renderOrder = 2;
      scene.add(water);

      const routeGroup = new THREE.Group();
      scene.add(routeGroup);

      // labels: places, rivers, main roads, evacuation centres
      const labelGroup = new THREE.Group();
      const tag = (text: string, cls: string, x: number, y: number, z: number) => {
        const d = document.createElement('div');
        d.className = `sk-label ${cls}`;
        d.textContent = text;
        const o = new CSS2DObject(d);
        o.position.set(x, y, z);
        labelGroup.add(o);
      };
      for (const l of model.meta.labels) tag(l.n, l.kind, l.x, l.kind === 'place' ? 40 : 6, -l.y);
      const pinMat = new THREE.MeshLambertMaterial({ color: 0x1E8E3E });
      for (const c of model.meta.centres) {
        const pin = new THREE.Mesh(new THREE.ConeGeometry(9, 26, 16), pinMat);
        pin.rotation.x = Math.PI;
        pin.position.set(c.x, 34, -c.y);
        pin.castShadow = true;
        scene.add(pin);
        tag(c.n, 'centre', c.x, 60, -c.y);
      }
      scene.add(labelGroup);

      const controls = new OrbitControls(camera, labels.domElement);
      controls.enableDamping = true;
      controls.dampingFactor = 0.08;
      controls.maxPolarAngle = Math.PI * 0.47;
      controls.minDistance = 120;
      controls.maxDistance = 9000;
      controls.autoRotateSpeed = 0.6;
      // start over Taman Sri Muda, looking north-west towards the river and the centres
      const [sx, sz] = toLocal(model.meta, [101.5345, 3.0315]);
      const home = () => {
        controls.target.set(sx, 0, sz);
        camera.position.set(sx + 1500, 1350, sz + 1900);
        controls.update();
      };
      home();

      const resize = () => {
        const w = el.clientWidth, h = el.clientHeight;
        renderer.setSize(w, h);
        labels.setSize(w, h);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
      };
      const ro = new ResizeObserver(resize);
      ro.observe(el);
      const loop = () => {
        controls.update();
        renderer.render(scene, camera);
        labels.render(scene, camera);
        raf = requestAnimationFrame(loop);
      };
      loop();

      three.current = { renderer, labels, scene, camera, controls, flood, water, route: routeGroup, labelGroup, model, home };
      setInfo({ buildings: model.meta.buildings, estimated: model.meta.heights_estimated, note: model.meta.note, centres: model.meta.centres });
      setStatus('ready');
      if (import.meta.env.DEV) (window as unknown as { __ginkgo3d?: Scene3D }).__ginkgo3d = three.current;
      dispose = () => {
        ro.disconnect();
        controls.dispose();
        scene.traverse(o => {
          const m = o as THREE.Mesh;
          m.geometry?.dispose();
          const mat = m.material as THREE.Material | THREE.Material[] | undefined;
          (Array.isArray(mat) ? mat : mat ? [mat] : []).forEach(x => x.dispose());
        });
        renderer.dispose();
        renderer.domElement.remove();
        labels.domElement.remove();
      };
    }).catch(() => { if (alive) setStatus('error'); });
    return () => { alive = false; cancelAnimationFrame(raf); dispose(); three.current = null; };
  }, [grid]);

  // ── water follows the drill clock ──
  const minute = Math.floor(t);
  useEffect(() => {
    const s = three.current;
    if (!s) return;
    setDepth(s.flood.update(sim, minute));
  }, [sim, minute, status]);
  useEffect(() => { if (three.current) three.current.water.visible = showWater; }, [showWater, status]);
  useEffect(() => { if (three.current) three.current.labelGroup.visible = showLabels; }, [showLabels, status]);
  useEffect(() => { if (three.current) three.current.controls.autoRotate = spin; }, [spin, status]);

  // ── evacuation route, raised above the street ──
  useEffect(() => {
    const s = three.current;
    if (!s) return;
    s.route.clear();
    if (!route || route.length < 2) return;
    const pts = route.map(p => { const [x, z] = toLocal(s.model.meta, p); return new THREE.Vector3(x, 2.5, z); });
    const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0);
    const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, Math.min(2000, pts.length * 6), 5, 6, false),
      new THREE.MeshLambertMaterial({ color: 0x1A73E8 }));
    tube.castShadow = true;
    const start = new THREE.Mesh(new THREE.SphereGeometry(16, 20, 14), new THREE.MeshLambertMaterial({ color: 0x1A73E8 }));
    start.position.copy(pts[0]).setY(16);
    s.route.add(tube, start);
  }, [route, status]);

  const centre = info && routeShelter !== null ? info.centres.find(c => c.id === routeShelter) : null;
  const ratio = Math.min(1, depth.max / HOUSE_M);

  return (
    <div className="sketch3d" ref={box}>
      <div className="sk-head">
        <div>
          <b>Taman Sri Muda · 3D sketch model</b>
          <span>{info ? `${info.buildings.toLocaleString('en-MY')} buildings from OpenStreetMap / Overture · heights mostly estimated` : 'Loading buildings…'}</span>
        </div>
        <div className="sk-tools">
          <button aria-pressed={showWater} onClick={() => setShowWater(v => !v)}>Water</button>
          <button aria-pressed={showLabels} onClick={() => setShowLabels(v => !v)}>Labels</button>
          <button aria-pressed={spin} onClick={() => setSpin(v => !v)}>Rotate</button>
          <button onClick={() => three.current?.home()}>Reset view</button>
          <button className="sk-close" onClick={onClose} aria-label="Close the 3D view">✕</button>
        </div>
      </div>
      {status === 'loading' && <div className="sk-status">Building the 3D model…</div>}
      {status === 'error' && <div className="sk-status">Could not load the 3D model.</div>}
      {status === 'ready' && (
        <div className="sk-card">
          {sim ? (
            <>
              <div className="sk-clock mono">{fmtClock(t)}</div>
              {depth.flooded ? (
                <>
                  <div className="sk-gauge" aria-label="Water depth against a two-storey house">
                    <svg viewBox="0 0 60 80">
                      <rect x="0" y={76 - ratio * 72} width="60" height={ratio * 72 + 4} fill="#5E9FE0" opacity=".55" />
                      <path d="M12 76 V40 L30 24 L48 40 V76 Z" fill="#fff" stroke="#2E2E2E" strokeWidth="1.4" />
                      <path d="M12 58 H48" stroke="#2E2E2E" strokeWidth=".8" strokeDasharray="2 2" />
                      <rect x="18" y="44" width="8" height="8" fill="none" stroke="#2E2E2E" strokeWidth=".9" />
                      <rect x="34" y="44" width="8" height="8" fill="none" stroke="#2E2E2E" strokeWidth=".9" />
                      <rect x="25" y="62" width="10" height="14" fill="none" stroke="#2E2E2E" strokeWidth=".9" />
                    </svg>
                  </div>
                  <div className="sk-text">
                    Deepest water here <b>≈{depth.max.toFixed(1)} m</b>, typical {depth.median.toFixed(1)} m · {depth.flooded} of the model's ~92 m cells under water.
                    <span>{depth.max >= 3.3 ? 'Above the first floor of a two-storey house.' : depth.max >= 1 ? 'Ground floors flooded; cars float from ~0.3 m.' : 'Shallow, but moving water knocks people over from ~0.15 m.'} Indicative depths from the drill.</span>
                  </div>
                </>
              ) : (
                <div className="sk-text">No water here yet. Press play below to watch it rise.</div>
              )}
              {centre && <div className="sk-route"><i /> Route to <b>{centre.n}</b></div>}
            </>
          ) : (
            <div className="sk-text">
              A white model of Taman Sri Muda and its neighbours along the Klang river — the area that flooded in December 2021.
              {onPlayFlood && <button className="btn btn-primary btn-sm" onClick={onPlayFlood}>▶ Play the flood here</button>}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default Sketch3D;
