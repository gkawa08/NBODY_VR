import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { VRButton } from 'three/addons/webxr/VRButton.js';

const G = 4.4985e-3;
const SIMULATION_BOUNDS = 40;
const PSEUDO_SPIN_PARAMETER_A = 0.6;
const SPIN_VECTOR_SCALE = 0.01;

let scene, camera, renderer, controls, cameraRig, clock, cubeFrame;
const bhObjects = new Map(), nsObjects = new Map(), ellipseObjects = new Map();
let timeData = new Map(), nsData = new Map(), interactionEvents = [], timeKeys = [], eventVectors = [];

let isPlaying = false, frameCount = 0, framesPerUpdate = 11, isCameraTracking = false, particleSizeMultiplier = 1.0, useComFrame = false;
let velScaleMultiplier = 1.0, spinScaleMultiplier = 1.0, showSpinVectors = false;
let cameraTargetGoal = new THREE.Vector3(), mouse = new THREE.Vector2(), raycaster = new THREE.Raycaster();
let highlightedBhId = null, massFilterMin = null, massFilterMax = null, selectedEvent = null;

const DEFAULT_COLOR = new THREE.Color(0x111111), BINARY_PARTICLE_COLOR = new THREE.Color(0xff00ff), INTERLOPER_PARTICLE_COLOR = new THREE.Color(0xff3131);
const PRE_EXCHANGE_ORBIT_COLOR = new THREE.Color(0x39ff14), POST_EVENT_COLOR = new THREE.Color(0x00ffff);

const VECTOR_COLOR = 0x0000ff;
const SPIN_VECTOR_COLOR = 0xff0000;
const REMNANT_VEL_COLOR = 0x00ffff;
const MERGE_SPIN_COLOR = 0xff8c00;
const COM_VELOCITY_COLOR = 0x0000ff;

let highlightColor = new THREE.Color(0xffff33), massRangeColor = new THREE.Color(0x39ff14);

function cleanup(obj) {
    if (!obj) return;
    if (obj.geometry) obj.geometry.dispose();
    if (obj.material) Array.isArray(obj.material) ? obj.material.forEach(m => m.dispose()) : obj.material.dispose();
    scene.remove(obj);
}

function init() {
    scene = new THREE.Scene();
    const bgV = parseInt(document.getElementById('bg-brightness-slider').value) / 255;
    scene.background = new THREE.Color(bgV, bgV, bgV);
    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(SIMULATION_BOUNDS * 0.7, SIMULATION_BOUNDS * 0.7, SIMULATION_BOUNDS * 0.7);
    clock = new THREE.Clock();
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.xr.enabled = true;
    document.body.appendChild(renderer.domElement);
    document.body.appendChild(VRButton.createButton(renderer));
    cameraRig = new THREE.Group();
    cameraRig.add(camera);
    scene.add(cameraRig);
    renderer.xr.addEventListener('sessionstart', onSessionStart);
    scene.add(new THREE.AmbientLight(0xffffff, 0.2));
    const dl = new THREE.DirectionalLight(0xffffff, 1);
    dl.position.set(1, 1, 1);
    scene.add(dl);
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    window.addEventListener('resize', () => {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    });
    document.addEventListener('mousemove', e => {
        mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
        mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
    });
    setupUI();
    addCubeFrame();
    renderer.setAnimationLoop(animate);
}

function addCubeFrame() {
    cubeFrame = new THREE.LineSegments(
        new THREE.EdgesGeometry(new THREE.BoxGeometry(SIMULATION_BOUNDS * 2, SIMULATION_BOUNDS * 2, SIMULATION_BOUNDS * 2)),
        new THREE.LineBasicMaterial({ color: 0x555555 })
    );
    scene.add(cubeFrame);
}

async function loadHistoryCsv(file, targetMap) {
    const res = await fetch(file);
    const text = await res.text();
    const rows = text.trim().split('\n');
    const headers = rows.shift().split(',').map(h => h.trim());
    rows.forEach(row => {
        const vals = row.split(','), data = {};
        headers.forEach((h, i) => {
            const v = vals[i]?.trim();
            data[h] = (h.includes('id') ? (v ? parseInt(v, 10) : null) : (v ? parseFloat(v) : null));
        });
        if (!targetMap.has(data.time_myr)) targetMap.set(data.time_myr, []);
        targetMap.get(data.time_myr).push(data);
    });
    if (targetMap === timeData) {
        timeKeys = Array.from(timeData.keys()).sort((a, b) => a - b);
        document.getElementById('time-slider').max = timeKeys.length - 1;
        updateBlackHoles(0);
    }
}

async function loadInteractionData() {
    try {
        const res = await fetch('bh_events.csv');
        const text = await res.text();
        const rows = text.trim().split('\n');
        const headers = rows.shift().split(',').map(h => h.trim());
        interactionEvents = [];
        rows.forEach(row => {
            const vals = row.split(','), raw = {};
            headers.forEach((h, i) => raw[h] = vals[i]?.trim());
            const type = raw['event_list'];
            if (type === 'EXCHANGE' || type === 'MERGE') {
                interactionEvents.push({
                    type: type,
                    time: parseFloat(raw['time_list'] || raw['time_myr']),
                    id1: parseInt(raw['id1_list']),
                    id2: parseInt(raw['id2_list']),
                    id3: parseInt(raw['id3_list']),
                    id4: parseInt(raw['id4_list'])
                });
            }
        });
    } catch (e) { console.warn(e); }
}

function drawArrow(p, d, l, c) {
    if (l <= 1e-6 || isNaN(d.x)) return;
    const a = new THREE.ArrowHelper(d.clone().normalize(), p, l, c);
    scene.add(a); eventVectors.push(a);
}

function drawVel(id, data, com, col = VECTOR_COLOR, sc = 20.0) {
    const d = data.find(b => b.bh_id === id);
    if (d) {
        const v = new THREE.Vector3(d.vx, d.vy, d.vz);
        drawArrow(new THREE.Vector3(d.x - com.x, d.y - com.y, d.z - com.z), v, v.length() * sc * velScaleMultiplier, col);
    }
}

function handleExchangeEvent(time, bhData, com) {
    const { time: et, id1, id2, id3, id4 } = selectedEvent;
    const interloper = (id3 === id1 || id3 === id2) ? id4 : id3;
    const ejected = (id1 === id3 || id1 === id4) ? id2 : id1;
    bhObjects.forEach((s, id) => {
        if (![id1, id2, id3, id4].includes(id)) { s.material.opacity = 0.1; s.material.color.set(DEFAULT_COLOR); }
        else {
            s.material.opacity = 1.0;
            if ([id1, id2].includes(id)) s.material.color.set(BINARY_PARTICLE_COLOR);
            else if (id === interloper) s.material.color.set(INTERLOPER_PARTICLE_COLOR);
            else s.material.color.set(DEFAULT_COLOR);
        }
    });
    const drawComVel = (i1, i2) => {
        const b1 = bhData.find(b => b.bh_id === i1), b2 = bhData.find(b => b.bh_id === i2);
        if (b1 && b2) {
            const p1 = new THREE.Vector3(b1.x, b1.y, b1.z), p2 = new THREE.Vector3(b2.x, b2.y, b2.z);
            const v1 = new THREE.Vector3(b1.vx, b1.vy, b1.vz), v2 = new THREE.Vector3(b2.vx, b2.vy, b2.vz);
            const m1 = b1.mass_msun, m2 = b2.mass_msun;
            const cv = v1.clone().multiplyScalar(m1).add(v2.clone().multiplyScalar(m2)).divideScalar(m1 + m2);
            const cp = p1.clone().multiplyScalar(m1).add(p2.clone().multiplyScalar(m2)).divideScalar(m1 + m2);
            drawArrow(cp.sub(com), cv, cv.length() * 20.0 * velScaleMultiplier, COM_VELOCITY_COLOR);
        }
    };
    if (time < et) {
        drawOrbit(id1, id2, bhData, com, PRE_EXCHANGE_ORBIT_COLOR);
        drawComVel(id1, id2);
        drawVel(interloper, bhData, com, VECTOR_COLOR, 20.0);
    } else {
        drawOrbit(id3, id4, bhData, com, POST_EVENT_COLOR);
        drawComVel(id3, id4);
        drawVel(ejected, bhData, com, VECTOR_COLOR, 20.0);
    }
}

function handleMergeEvent(time, bhData, com) {
    const { time: et, id1, id2 } = selectedEvent;
    const curIds = new Set(bhData.map(b => b.bh_id));
    const rid = curIds.has(id1) ? id1 : (curIds.has(id2) ? id2 : null);
    bhObjects.forEach((s, id) => {
        if (![id1, id2, rid].includes(id)) s.material.opacity = 0.1;
        else {
            s.material.opacity = 1.0;
            if (time < et) { if ([id1, id2].includes(id)) s.material.color.set(BINARY_PARTICLE_COLOR); }
            else { if (id === rid) s.material.color.set(POST_EVENT_COLOR); else s.material.opacity = 0.1; }
        }
    });
    const kickIdx = timeKeys.findIndex(t => t >= et);
    const preT = timeKeys[kickIdx - 1];
    if (time < et) {
        drawOrbit(id1, id2, bhData, com, PRE_EXCHANGE_ORBIT_COLOR);
        const b1 = bhData.find(b => b.bh_id === id1), b2 = bhData.find(b => b.bh_id === id2);
        if (b1 && b2) {
            const p1 = new THREE.Vector3(b1.x, b1.y, b1.z), p2 = new THREE.Vector3(b2.x, b2.y, b2.z);
            const v1 = new THREE.Vector3(b1.vx, b1.vy, b1.vz), v2 = new THREE.Vector3(b2.vx, b2.vy, b2.vz);
            const m1 = b1.mass_msun, m2 = b2.mass_msun;
            const cv = v1.clone().multiplyScalar(m1).add(v2.clone().multiplyScalar(m2)).divideScalar(m1 + m2);
            const cp = p1.clone().multiplyScalar(m1).add(p2.clone().multiplyScalar(m2)).divideScalar(m1 + m2);
            drawArrow(cp.sub(com), cv, cv.length() * 20.0 * velScaleMultiplier, COM_VELOCITY_COLOR);
            if (showSpinVectors) {
                const sdir = new THREE.Vector3().crossVectors(p1.clone().sub(p2), v1.clone().sub(v2)).normalize();
                drawArrow(new THREE.Vector3(b1.x - com.x, b1.y - com.y, b1.z - com.z), sdir, SPIN_VECTOR_SCALE * spinScaleMultiplier * PSEUDO_SPIN_PARAMETER_A * m1 * m1, SPIN_VECTOR_COLOR);
                drawArrow(new THREE.Vector3(b2.x - com.x, b2.y - com.y, b2.z - com.z), sdir, SPIN_VECTOR_SCALE * spinScaleMultiplier * PSEUDO_SPIN_PARAMETER_A * m2 * m2, SPIN_VECTOR_COLOR);
            }
        }
    } else if (rid !== null && preT) {
        const rd = bhData.find(b => b.bh_id === rid);
        const preData = timeData.get(preT);
        const b1 = preData.find(b => b.bh_id === id1), b2 = preData.find(b => b.bh_id === id2);
        if (rd && b1 && b2) {
            const v1 = new THREE.Vector3(b1.vx, b1.vy, b1.vz), v2 = new THREE.Vector3(b2.vx, b2.vy, b2.vz);
            const m1 = b1.mass_msun, m2 = b2.mass_msun;
            const vComPre = v1.clone().multiplyScalar(m1).add(v2.clone().multiplyScalar(m2)).divideScalar(m1 + m2);
            const vRem = new THREE.Vector3(rd.vx, rd.vy, rd.vz);
            const vKick = vRem.clone().sub(vComPre);
            drawArrow(new THREE.Vector3(rd.x - com.x, rd.y - com.y, rd.z - com.z), vRem, vRem.length() * 20.0 * velScaleMultiplier, REMNANT_VEL_COLOR);
            if (showSpinVectors) {
                const h = new THREE.Vector3().crossVectors(new THREE.Vector3(b1.x - b2.x, b1.y - b2.y, b1.z - b2.z), new THREE.Vector3(b1.vx - b2.vx, b1.vy - b2.vy, b1.vz - b2.vz));
                const sdir = h.normalize();
                const smag = SPIN_VECTOR_SCALE * spinScaleMultiplier * PSEUDO_SPIN_PARAMETER_A * rd.mass_msun * rd.mass_msun;
                drawArrow(new THREE.Vector3(rd.x - com.x, rd.y - com.y, rd.z - com.z), sdir, smag, MERGE_SPIN_COLOR);
            }
        }
    }
}

function updateBlackHoles(idx) {
    if (idx >= timeKeys.length || idx < 0) return;
    const time = timeKeys[idx], bhs = timeData.get(time);
    document.getElementById('time-slider').value = idx;
    document.getElementById('time-label').textContent = `${time.toFixed(2)} Myr`;
    eventVectors.forEach(v => cleanup(v)); eventVectors = [];
    ellipseObjects.forEach(o => cleanup(o)); ellipseObjects.clear();
    const com = new THREE.Vector3();
    if (useComFrame) {
        let tm = 0;
        [...bhs, ...(nsData.get(time) || [])].forEach(p => { if(p.mass_msun){ tm += p.mass_msun; com.addScaledVector(new THREE.Vector3(p.x, p.y, p.z), p.mass_msun); } });
        if (tm > 0) com.divideScalar(tm);
    }
    cubeFrame.position.copy(com).negate();
    const ids = new Set(bhs.map(b => b.bh_id));
    bhObjects.forEach((o, id) => { if (!ids.has(id)) { cleanup(o); bhObjects.delete(id); } });
    bhs.forEach(bh => {
        let s = bhObjects.get(bh.bh_id);
        if (!s) {
            s = new THREE.Mesh(new THREE.SphereGeometry(0.01, 32, 32), new THREE.MeshPhysicalMaterial({ metalness: 0.9, roughness: 0.1, clearcoat: 1.0, transparent: true }));
            bhObjects.set(bh.bh_id, s); scene.add(s);
        }
        s.userData.bhData = bh;
        s.position.set(bh.x - com.x, bh.y - com.y, bh.z - com.z);
        const sc = bh.mass_msun * particleSizeMultiplier; s.scale.set(sc, sc, sc);
    });
    if (selectedEvent) {
        if (selectedEvent.type === 'EXCHANGE') handleExchangeEvent(time, bhs, com);
        else if (selectedEvent.type === 'MERGE') handleMergeEvent(time, bhs, com);
    } else {
        bhObjects.forEach(s => {
            const d = s.userData.bhData;
            if (highlightedBhId === d.bh_id) s.material.color.set(highlightColor);
            else if (massFilterMin !== null && massFilterMax !== null && d.mass_msun >= massFilterMin && d.mass_msun <= massFilterMax) s.material.color.set(massRangeColor);
            else s.material.color.set(DEFAULT_COLOR);
            s.material.opacity = 1.0;
        });
        if (highlightedBhId !== null) drawVel(highlightedBhId, bhs, com, highlightColor, 20.0);
    }
    if (isCameraTracking && !renderer.xr.isPresenting) {
        let tp = null;
        if (highlightedBhId !== null) { const o = bhObjects.get(highlightedBhId); if (o) tp = o.position; }
        else if (selectedEvent) {
            const ids = selectedEvent.type === 'EXCHANGE' ? [selectedEvent.id1, selectedEvent.id2, selectedEvent.id3, selectedEvent.id4] : [selectedEvent.id1, selectedEvent.id2];
            const active = ids.map(id => bhObjects.get(id)).filter(o => o && o.position.length() < SIMULATION_BOUNDS);
            if (active.length > 0) tp = active.reduce((acc, o) => acc.add(o.position), new THREE.Vector3()).divideScalar(active.length);
        }
        cameraTargetGoal.lerp(tp || new THREE.Vector3(), 0.1);
    }
    updateNS(time, com);
}

function drawOrbit(id1, id2, data, com, col) {
    const b1 = data.find(b => b.bh_id === id1), b2 = data.find(b => b.bh_id === id2);
    if (!b1 || !b2) return;
    const m1 = b1.mass_msun, m2 = b2.mass_msun, M = m1 + m2;
    const r1 = new THREE.Vector3(b1.x, b1.y, b1.z), r2 = new THREE.Vector3(b2.x, b2.y, b2.z), relR = r1.clone().sub(r2);
    const v1 = new THREE.Vector3(b1.vx, b1.vy, b1.vz), v2 = new THREE.Vector3(b2.vx, b2.vy, b2.vz), relV = v1.clone().sub(v2);
    const h = new THREE.Vector3().crossVectors(relR, relV), en = 0.5 * relV.lengthSq() - (G * M / relR.length());
    if (en < 0) {
        const a = -G * M / (2 * en), ev = relV.clone().cross(h).divideScalar(G * M).sub(relR.clone().normalize()), e = ev.length();
        if (e < 1) {
            const b = a * Math.sqrt(1 - e * e), cp = r1.clone().multiplyScalar(m1).add(r2.clone().multiplyScalar(m2)).divideScalar(M);
            const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,0,1), h.clone().normalize());
            const ang = new THREE.Vector3(1,0,0).applyQuaternion(q).angleTo(ev) * Math.sign(h.clone().normalize().dot(new THREE.Vector3(1,0,0).applyQuaternion(q).cross(ev)));
            [m2/M, m1/M].forEach((s, i) => {
                const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints(new THREE.EllipseCurve(-a * s * e, 0, a * s, b * s, 0, 2 * Math.PI).getPoints(64)), new THREE.LineBasicMaterial({ color: col }));
                l.position.copy(cp).sub(com); l.quaternion.copy(q); l.rotateOnAxis(new THREE.Vector3(0,0,1), ang + i * Math.PI);
                scene.add(l); ellipseObjects.set(`${id1}-${id2}-${i}`, l);
            });
        }
    }
}

function updateNS(t, com) {
    const cur = nsData.get(t) || [], ids = new Set(cur.map(n => n.ns_id));
    nsObjects.forEach((o, id) => { if (!ids.has(id)) { cleanup(o); nsObjects.delete(id); } });
    cur.forEach(n => {
        let s = nsObjects.get(n.ns_id);
        if (!s) {
            s = new THREE.Mesh(new THREE.SphereGeometry(0.01, 32, 32), new THREE.MeshPhysicalMaterial({ color: 0xffa500, emissive: 0xff4500, emissiveIntensity: 2.0, transparent: true }));
            nsObjects.set(n.ns_id, s); scene.add(s);
        }
        s.userData.nsData = n; s.position.set(n.x - com.x, n.y - com.y, n.z - com.z);
        const sc = n.mass_msun * particleSizeMultiplier; s.scale.set(sc, sc, sc);
        s.visible = document.getElementById('ns-visible-checkbox').checked;
    });
}

function setupUI() {
    const ui = document.getElementById('ui-controls'), ts = document.getElementById('time-slider');
    const stop = e => e.stopPropagation();
    ['pointerdown', 'pointermove', 'pointerup', 'wheel', 'touchstart', 'touchmove', 'touchend'].forEach(ev => ui.addEventListener(ev, stop, { passive: false }));
    document.getElementById('play-pause-btn').addEventListener('click', e => { isPlaying = !isPlaying; e.target.textContent = isPlaying ? 'Pause' : 'Play'; });
    document.getElementById('reset-camera-btn').addEventListener('click', () => {
        camera.position.set(SIMULATION_BOUNDS * 0.7, SIMULATION_BOUNDS * 0.7, SIMULATION_BOUNDS * 0.7);
        controls.target.set(0, 0, 0);
        cameraTargetGoal.set(0, 0, 0);
        controls.update();
    });
    ts.addEventListener('pointerdown', () => isPlaying = false);
    ts.addEventListener('input', e => updateBlackHoles(parseInt(e.target.value)));
    const ids = ['speed-slider', 'bh-size-slider', 'vel-scale-slider', 'spin-scale-slider', 'bg-brightness-slider', 'highlight-color-input', 'mass-range-color-input', 'mass-min-input', 'mass-max-input', 'highlight-bh-input', 'interaction-event-select'];
    ids.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('input', e => {
        if (id === 'speed-slider') framesPerUpdate = 21 - parseInt(e.target.value);
        if (id === 'bh-size-slider') particleSizeMultiplier = parseFloat(e.target.value);
        if (id === 'vel-scale-slider') velScaleMultiplier = parseFloat(e.target.value);
        if (id === 'spin-scale-slider') spinScaleMultiplier = parseFloat(e.target.value);
        if (id === 'bg-brightness-slider') { const v = e.target.value / 255; scene.background.setRGB(v, v, v); }
        if (id === 'highlight-color-input') highlightColor.set(e.target.value);
        if (id === 'mass-range-color-input') massRangeColor.set(e.target.value);
        if (id.includes('mass-')) { massFilterMin = parseFloat(document.getElementById('mass-min-input').value) || null; massFilterMax = parseFloat(document.getElementById('mass-max-input').value) || null; }
        if (id === 'highlight-bh-input') highlightedBhId = parseInt(e.target.value) || null;
        if (id === 'interaction-event-select') {
            selectedEvent = interactionEvents[e.target.value] || null;
            if (selectedEvent) {
                const targetIdx = timeKeys.findIndex(t => t >= selectedEvent.time);
                if (targetIdx !== -1) ts.value = targetIdx;
            }
        }
        updateBlackHoles(parseInt(ts.value));
    })});
    document.getElementById('clear-highlight-btn').addEventListener('click', () => { document.getElementById('highlight-bh-input').value = ''; highlightedBhId = null; updateBlackHoles(parseInt(ts.value)); });
    ['ns-visible-checkbox', 'com-frame-checkbox', 'camera-track-checkbox', 'spin-visible-checkbox'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('change', e => {
        if(id==='camera-track-checkbox') isCameraTracking = e.target.checked;
        if(id==='com-frame-checkbox') useComFrame = e.target.checked;
        if(id==='spin-visible-checkbox') showSpinVectors = e.target.checked;
        updateBlackHoles(parseInt(ts.value));
    })});
}

function animate() {
    const dt = clock.getDelta();
    if (isPlaying) {
        frameCount++;
        if (frameCount >= framesPerUpdate) {
            frameCount = 0;
            const s = document.getElementById('time-slider');
            s.value = (parseInt(s.value) + 1) % timeKeys.length;
            updateBlackHoles(parseInt(s.value));
        }
    }
    if (renderer.xr.isPresenting) {
        const ses = renderer.xr.getSession();
        if (ses) ses.inputSources.forEach(src => { if(src.gamepad){ const y = src.gamepad.axes[3] || 0; if(Math.abs(y)>0.1){ const d = new THREE.Vector3(); camera.getWorldDirection(d); cameraRig.position.addScaledVector(d, -y * 5 * dt); } } });
    } else { if (isCameraTracking) controls.target.lerp(cameraTargetGoal, 0.1); controls.update(); }
    raycaster.setFromCamera(mouse, camera);
    const hits = raycaster.intersectObjects([...bhObjects.values(), ...nsObjects.values()].filter(o => o.visible && o.material.opacity > 0.05));
    const info = document.getElementById('tracking-info');
    if (hits.length > 0) {
        const hitObj = hits[0].object;
        const d = hitObj.userData.bhData || hitObj.userData.nsData;
        let infoText = `ID: ${d.bh_id ?? d.ns_id}\nMass: ${d.mass_msun.toFixed(2)}`;
        if (highlightedBhId !== null) {
            const hObj = bhObjects.get(highlightedBhId);
            if (hObj && highlightedBhId !== (d.bh_id ?? d.ns_id)) {
                const dist = hObj.position.distanceTo(hitObj.position);
                infoText += `\nDist to ${highlightedBhId}: ${dist.toFixed(2)} pc`;
            }
        }
        info.innerHTML = infoText;
        info.style.display = 'block';
    } else info.style.display = 'none';
    if (camera.position.length() > 0) {
        const pxW = (10 / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * camera.position.length() * camera.aspect)) * window.innerWidth;
        document.getElementById('scale-bar-line').style.width = `${pxW}px`;
        document.getElementById('scale-bar-label').textContent = `10 pc`;
    }
    renderer.render(scene, camera);
}

function onSessionStart() {
    camera.getWorldPosition(cameraRig.position);
    const e = new THREE.Euler().setFromQuaternion(camera.getWorldQuaternion(new THREE.Quaternion()), 'YXZ');
    e.x = 0; e.z = 0; cameraRig.quaternion.setFromEuler(e);
    camera.position.set(0, 0, 0); camera.quaternion.identity();
}

function populateEventSelector() {
    const s = document.getElementById('interaction-event-select');
    s.innerHTML = '<option value="-1">None</option>';
    const maxTime = timeKeys.length > 0 ? timeKeys[timeKeys.length - 1] : Infinity;
    interactionEvents.forEach((e, i) => {
        if (e.time > maxTime) return;
        const o = document.createElement('option'); o.value = i;
        o.textContent = `${e.type} @ ${e.time.toFixed(0)}: (${e.id1},${e.id2})${e.type==='EXCHANGE' ? '->('+e.id3+','+e.id4+')' : ''}`;
        s.appendChild(o);
    });
}

init();
Promise.all([
    loadHistoryCsv('bh_history.csv', timeData),
    loadHistoryCsv('ns_history.csv', nsData),
    loadInteractionData()
]).then(() => populateEventSelector()).catch(console.error);