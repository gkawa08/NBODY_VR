import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// --- Configuration ---
const G = 4.4985e-3; // Gravitational constant in pc^3 / (M_sun * Myr^2)
const SIMULATION_BOUNDS = 40; 

// --- Global variables ---
let scene, camera, renderer, controls;
const bhObjects = new Map();
let timeData = new Map();
let timeKeys = [];
let isPlaying = false;
let frameCount = 0;
let framesPerUpdate = 11;
let isCameraTracking = true;
let particleSizeMultiplier = 1.0; 

const ellipseObjects = new Map(); 

const DEFAULT_COLOR = new THREE.Color(0x050505);
const BINARY_COLOR = new THREE.Color(0x00ff00);
const INTERLOPER_COLOR = new THREE.Color(0xff0000);

let raycaster;
let mouse;
let INTERSECTED; 

let interactionMap = new Map();
let historicalPartners = new Set();
let exchangeEvents = [];
let selectedExchangeEvent = null;

let nsData = new Map();
const nsObjects = new Map();

// --- Initialization ---
function init() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0xdddddd);
    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(SIMULATION_BOUNDS * 0.7, SIMULATION_BOUNDS * 0.7, SIMULATION_BOUNDS * 0.7);
    camera.lookAt(0, 0, 0);
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    document.body.appendChild(renderer.domElement);
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
    scene.add(ambientLight);
    const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
    directionalLight.position.set(1, 1, 1);
    scene.add(directionalLight);
    controls = new OrbitControls(camera, renderer.domElement);
    controls.maxDistance = 200;
    controls.minDistance = 0.1;
    raycaster = new THREE.Raycaster();
    mouse = new THREE.Vector2();
    window.addEventListener('resize', onWindowResize, false);
    document.addEventListener('mousemove', onDocumentMouseMove, false);
    setupUI();
    addCubeFrame();
    animate();
}

function addCubeFrame() {
    const geometry = new THREE.BoxGeometry(SIMULATION_BOUNDS * 2, SIMULATION_BOUNDS * 2, SIMULATION_BOUNDS * 2);
    const edges = new THREE.EdgesGeometry(geometry);
    const line = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0x888888 }));
    scene.add(line);
}

function parseCsvRow(rowString, headers) {
    const rowData = {};
    const values = rowString.split(',');
    headers.forEach((header, i) => {
        const key = header.trim();
        const value = values[i] ? values[i].trim() : '';
        if (key === 'event_list') {
            rowData[key] = value;
        } else if (key.includes('id')) {
            rowData[key] = value ? parseInt(value, 10) : null;
        } else {
            rowData[key] = value ? parseFloat(value) : null;
        }
    });
    return rowData;
}

async function loadInteractionData() {
    const response = await fetch('bh_events.csv');
    const csvData = await response.text();
    
    const rows = csvData.trim().split('\n');
    const headers = rows.shift().split(',').map(h => h.trim());
    
    const allIds = new Set();
    const tempInteractionMap = new Map();
    exchangeEvents = [];

    for (const row of rows) {
        const rowData = parseCsvRow(row, headers);
        const { event_list, id1_list, id2_list, id3_list, id4_list, time_list } = rowData;

        if (id1_list && id2_list) {
            allIds.add(id1_list);
            allIds.add(id2_list);
            if (!tempInteractionMap.has(id1_list)) tempInteractionMap.set(id1_list, new Set());
            if (!tempInteractionMap.has(id2_list)) tempInteractionMap.set(id2_list, new Set());
            tempInteractionMap.get(id1_list).add(id2_list);
            tempInteractionMap.get(id2_list).add(id1_list);
        }

        if (event_list === 'EXCHANGE' && id1_list && id2_list && id3_list && id4_list) {
             exchangeEvents.push({
                 time: time_list,
                 id1: id1_list, id2: id2_list, id3: id3_list, id4: id4_list,
             });
        }
    }

    interactionMap = tempInteractionMap;
    const sortedIds = Array.from(allIds).sort((a, b) => a - b);

    const primaryBhSelect = document.getElementById('primary-bh-select');
    primaryBhSelect.innerHTML = '';
    sortedIds.forEach(id => {
        const option = document.createElement('option');
        option.value = id;
        option.textContent = id;
        primaryBhSelect.appendChild(option);
    });
    
    if (sortedIds.length > 0) {
        primaryBhSelect.value = sortedIds[0];
        updateHistoricalPartners();
    }
    
    populateExchangeSelector();
}

async function loadData() {
    const response = await fetch('bh_history.csv');
    const textData = await response.text();
    
    const rows = textData.trim().split('\n');
    const headers = rows.shift().split(',');

    for (const row of rows) {
        const rowData = parseCsvRow(row, headers);
        const time = rowData.time_myr;
        if (time === null || isNaN(time)) continue;

        if (!timeData.has(time)) {
            timeData.set(time, []);
        }
        timeData.get(time).push(rowData);
    }
    timeKeys = Array.from(timeData.keys()).sort((a, b) => a - b);
    
    const slider = document.getElementById('time-slider');
    slider.max = timeKeys.length - 1;
    updateBlackHoles(0);
}

async function loadNSData() {
    try {
        const response = await fetch('ns_history.csv');
        const textData = await response.text();
        const rows = textData.trim().split('\n');
        const headers = rows.shift().split(',');

        for (const row of rows) {
            const rowData = parseCsvRow(row, headers);
            const time = rowData.time_myr;
            if (time === null || isNaN(time)) continue;

            if (!nsData.has(time)) {
                nsData.set(time, []);
            }
            nsData.get(time).push(rowData);
        }
    } catch (e) {
        console.warn("Could not load ns_history.csv. NS will not be displayed.");
    }
}

function updateBlackHoles(timeIndex) {
    if (timeIndex >= timeKeys.length) return;
    const time = timeKeys[timeIndex];
    const bhData = timeData.get(time);
    
    const slider = document.getElementById('time-slider');
    slider.value = timeIndex;
    const timeLabel = document.getElementById('time-label');
    timeLabel.textContent = `${time.toFixed(2)} Myr`;

    const visibleBhIds = new Set(bhData.map(bh => bh.bh_id));
    for (const bhId of bhObjects.keys()) {
        if (!visibleBhIds.has(bhId)) {
            const obj = bhObjects.get(bhId);
            scene.remove(obj);
            bhObjects.delete(bhId);
        }
    }
    ellipseObjects.forEach(ellipse => scene.remove(ellipse));
    ellipseObjects.clear();

    const primaryBhSelect = document.getElementById('primary-bh-select');
    const primaryId = parseInt(primaryBhSelect.value);
    const primaryBhData = !isNaN(primaryId) ? bhData.find(bh => bh.bh_id === primaryId) : null;

    if (selectedExchangeEvent) {
        const { id1, id2, id3, id4 } = selectedExchangeEvent;
        const interloperId = (id3 === id1 || id3 === id2) ? id4 : id3;

        bhData.forEach(bh => {
            let sphere = getOrCreateBHSphere(bh);
            if (bh.bh_id === id1 || bh.bh_id === id2) {
                sphere.material.color.set(BINARY_COLOR);
                sphere.material.opacity = 1.0;
            } else if (bh.bh_id === interloperId) {
                sphere.material.color.set(INTERLOPER_COLOR);
                sphere.material.opacity = 1.0;
            } else {
                sphere.material.color.set(DEFAULT_COLOR);
                sphere.material.opacity = 0.1;
            }
        });
    } else {
        bhData.forEach(bh => {
            let sphere = getOrCreateBHSphere(bh);
            if (bh.bh_id === primaryId || historicalPartners.has(bh.bh_id)) {
                sphere.material.opacity = 1.0; 
            } else {
                sphere.material.opacity = 0.3;
            }
        });
        if (primaryBhData) {
            drawEllipses(primaryBhData, bhData);
        }
    }
    
    if (isCameraTracking) {
        let targetPosition = null;
        if (selectedExchangeEvent) {
            const { id1, id2, id3, id4 } = selectedExchangeEvent;
            const interloperId = (id3 === id1 || id3 === id2) ? id4 : id3;
            const actors = [
                bhObjects.get(id1),
                bhObjects.get(id2),
                bhObjects.get(interloperId)
            ];
            const validActors = actors.filter(obj => {
                if (!obj) return false;
                const pos = obj.position;
                return Math.abs(pos.x) <= SIMULATION_BOUNDS &&
                       Math.abs(pos.y) <= SIMULATION_BOUNDS &&
                       Math.abs(pos.z) <= SIMULATION_BOUNDS;
            });

            if (validActors.length > 0) {
                targetPosition = new THREE.Vector3();
                validActors.forEach(obj => targetPosition.add(obj.position));
                targetPosition.divideScalar(validActors.length);
            }
        } else if (!isNaN(primaryId)) {
            const trackedBhObject = bhObjects.get(primaryId);
            if (trackedBhObject) {
                targetPosition = trackedBhObject.position;
            }
        }

        if (targetPosition) {
            controls.target.copy(targetPosition);
        }
    }
    updateNSObjects(time);
}

function getOrCreateBHSphere(bh) {
    let sphere = bhObjects.get(bh.bh_id);
    if (!sphere) {
        const geometry = new THREE.SphereGeometry(0.2, 32, 32);
        const material = new THREE.MeshStandardMaterial({ color: DEFAULT_COLOR, transparent: true, opacity: 1.0 });
        sphere = new THREE.Mesh(geometry, material);
        bhObjects.set(bh.bh_id, sphere);
        scene.add(sphere);
    }
    sphere.userData.bhData = bh; 
    sphere.position.set(bh.x, bh.y, bh.z);
    sphere.scale.set(particleSizeMultiplier, particleSizeMultiplier, particleSizeMultiplier);
    sphere.material.color.set(DEFAULT_COLOR);
    return sphere;
}

function drawEllipses(primaryBh, bhData) {
    bhData.forEach(otherBh => {
        if (otherBh.bh_id === primaryBh.bh_id) return;

        if (historicalPartners.has(otherBh.bh_id)) {
            const bh1 = primaryBh, bh2 = otherBh;
            const m1 = bh1.mass_msun, m2 = otherBh.mass_msun;
            const r1 = new THREE.Vector3(bh1.x, bh1.y, bh1.z), r2 = new THREE.Vector3(otherBh.x, otherBh.y, otherBh.z);
            const v1 = new THREE.Vector3(bh1.vx, bh1.vy, bh1.vz), v2 = new THREE.Vector3(otherBh.vx, otherBh.vy, otherBh.vz);
            const r12 = r1.distanceTo(r2);
            if (r12 === 0) return;

            const E_kin = 0.5 * m1 * v1.lengthSq() + 0.5 * m2 * v2.lengthSq();
            const E_pot = -G * m1 * m2 / r12;
            const E_bin = E_kin + E_pot;

            if (E_bin < 0) {
                const r_vec = new THREE.Vector3().subVectors(r2, r1), v_vec = new THREE.Vector3().subVectors(v2, v1);
                const mu = G * (m1 + m2), h_vec = new THREE.Vector3().crossVectors(r_vec, v_vec);
                const e_vec = new THREE.Vector3().crossVectors(v_vec, h_vec).divideScalar(mu).sub(r_vec.clone().normalize());
                const e = e_vec.length();
                if (e < 1) {
                    const a = h_vec.lengthSq() / (mu * (1 - e*e)), b = a * Math.sqrt(1 - e*e);
                    const center = new THREE.Vector3().addVectors(r1.clone().multiplyScalar(m1), r2.clone().multiplyScalar(m2)).divideScalar(m1 + m2);
                    if(a > 0 && b > 0) {
                        const curve = new THREE.EllipseCurve(0, 0, a, b, 0, 2 * Math.PI, false, 0);
                        const points = curve.getPoints(100);
                        const geometry = new THREE.BufferGeometry().setFromPoints(points);
                        const material = new THREE.LineBasicMaterial({ color: 0x0000ff });
                        const ellipseLine = new THREE.Line(geometry, material);
                        const z_axis = new THREE.Vector3(0,0,1), q = new THREE.Quaternion().setFromUnitVectors(z_axis, h_vec.clone().normalize());
                        ellipseLine.quaternion.copy(q);
                        const angle = new THREE.Vector3(1, 0, 0).angleTo(e_vec), cross = new THREE.Vector3(1,0,0).cross(e_vec);
                        if (cross.z < 0) { ellipseLine.rotateOnAxis(new THREE.Vector3(0,0,1), -angle); } else { ellipseLine.rotateOnAxis(new THREE.Vector3(0,0,1), angle); }
                        ellipseLine.position.copy(center);
                        scene.add(ellipseLine);
                        const pairId = Math.min(bh1.bh_id, bh2.bh_id) + '-' + Math.max(bh1.bh_id, bh2.bh_id);
                        ellipseObjects.set(pairId, ellipseLine);
                    }
                }
            }
        }
    });
}

function updateNSObjects(time) {
    const currentNSs = nsData.get(time) || [];
    const visibleNsIds = new Set(currentNSs.map(ns => ns.ns_id));

    for (const nsId of nsObjects.keys()) {
        if (!visibleNsIds.has(nsId)) {
            const obj = nsObjects.get(nsId);
            scene.remove(obj);
            nsObjects.delete(nsId);
        }
    }

    currentNSs.forEach(ns => {
        let sphere = nsObjects.get(ns.ns_id);
        if (!sphere) {
            const geometry = new THREE.SphereGeometry(0.15, 16, 16); 
            const material = new THREE.MeshStandardMaterial({ 
                color: 0xffa500,
                transparent: true, 
                opacity: 0.5 
            });
            sphere = new THREE.Mesh(geometry, material);
            sphere.userData.nsData = ns;
            nsObjects.set(ns.ns_id, sphere);
            scene.add(sphere);
        }
        sphere.userData.nsData = ns;
        sphere.position.set(ns.x, ns.y, ns.z);
        sphere.scale.set(particleSizeMultiplier * 0.7, particleSizeMultiplier * 0.7, particleSizeMultiplier * 0.7);
        sphere.visible = document.getElementById('ns-visible-checkbox').checked;
    });
}

function updateHistoricalPartners() {
    const primaryBhSelect = document.getElementById('primary-bh-select');
    const primaryId = parseInt(primaryBhSelect.value);
    if (!isNaN(primaryId) && interactionMap.has(primaryId)) {
        historicalPartners = interactionMap.get(primaryId);
    } else {
        historicalPartners.clear();
    }
    const slider = document.getElementById('time-slider');
    updateBlackHoles(parseInt(slider.value));
}

function populateExchangeSelector() {
    const select = document.getElementById('exchange-event-select');
    select.innerHTML = ''; 

    const defaultOption = document.createElement('option');
    defaultOption.value = -1;
    defaultOption.textContent = 'Normal Mode';
    select.appendChild(defaultOption);

    exchangeEvents.forEach((event, index) => {
        const option = document.createElement('option');
        option.value = index;
        option.textContent = `Time ${event.time.toFixed(0)}: (${event.id1}, ${event.id2}) -> (${event.id3}, ${event.id4})`;
        select.appendChild(option);
    });
}

function setupUI() {
    const playPauseBtn = document.getElementById('play-pause-btn');
    const slider = document.getElementById('time-slider');
    const speedSlider = document.getElementById('speed-slider');
    const cameraTrackCheckbox = document.getElementById('camera-track-checkbox');
    const primaryBhSelect = document.getElementById('primary-bh-select');
    const bhSizeSlider = document.getElementById('bh-size-slider');
    const nsVisibleCheckbox = document.getElementById('ns-visible-checkbox');
    const exchangeEventSelect = document.getElementById('exchange-event-select');
    
    const uiControls = document.getElementById('ui-controls');
    const stopPropagation = (event) => event.stopPropagation();
    uiControls.addEventListener('pointerdown', stopPropagation);
    uiControls.addEventListener('pointermove', stopPropagation);
    uiControls.addEventListener('pointerup', stopPropagation);
    uiControls.addEventListener('wheel', stopPropagation);

    playPauseBtn.addEventListener('click', () => {
        isPlaying = !isPlaying;
        playPauseBtn.textContent = isPlaying ? 'Pause' : 'Play';
    });

    slider.addEventListener('mousedown', () => {
        if (isPlaying) { isPlaying = false; playPauseBtn.textContent = 'Play'; }
    });
    slider.addEventListener('input', e => updateBlackHoles(parseInt(e.target.value)));
    
    speedSlider.addEventListener('input', e => { framesPerUpdate = 21 - parseInt(e.target.value); });

    cameraTrackCheckbox.addEventListener('change', e => {
        isCameraTracking = e.target.checked;
    });
    
    primaryBhSelect.addEventListener('change', () => {
        exchangeEventSelect.value = -1;
        selectedExchangeEvent = null;
        updateHistoricalPartners();
    });

    particleSizeMultiplier = parseFloat(bhSizeSlider.value) * 0.01;

    bhSizeSlider.addEventListener('input', e => {
        particleSizeMultiplier = parseFloat(e.target.value) * 0.01; 
        bhObjects.forEach(sphere => {
            sphere.scale.set(particleSizeMultiplier, particleSizeMultiplier, particleSizeMultiplier);
        });
        nsObjects.forEach(sphere => {
            sphere.scale.set(particleSizeMultiplier * 0.7, particleSizeMultiplier * 0.7, particleSizeMultiplier * 0.7);
        });
    });

    nsVisibleCheckbox.addEventListener('change', e => {
        const isVisible = e.target.checked;
        nsObjects.forEach(sphere => {
            sphere.visible = isVisible;
        });
    });

    exchangeEventSelect.addEventListener('change', (e) => {
        const selectedIndex = parseInt(e.target.value);
        if (selectedIndex === -1) {
            selectedExchangeEvent = null;
            primaryBhSelect.disabled = false;
        } else {
            selectedExchangeEvent = exchangeEvents[selectedIndex];
            primaryBhSelect.disabled = true;

            const targetTime = selectedExchangeEvent.time - 100;
            const closestTimeIndex = timeKeys.reduce((prev, curr, index) => {
                return (Math.abs(curr - targetTime) < Math.abs(timeKeys[prev] - targetTime) ? index : prev);
            }, 0);
            
            slider.value = closestTimeIndex;
        }
        updateBlackHoles(parseInt(slider.value));
    });
}

function onDocumentMouseMove(event) {
    event.preventDefault();
    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
}

function updateInfoBox() {
    raycaster.setFromCamera(mouse, camera);
    const intersectableObjects = [...Array.from(bhObjects.values()), ...Array.from(nsObjects.values())];
    const intersects = raycaster.intersectObjects(intersectableObjects.filter(o => o.visible && o.material.opacity > 0.15));

    const infoBox = document.getElementById('tracking-info');

    if (intersects.length > 0) {
        if (INTERSECTED != intersects[0].object) {
            INTERSECTED = intersects[0].object;
            const bhData = INTERSECTED.userData.bhData;
            const nsData = INTERSECTED.userData.nsData; 
            
            if (bhData) {
                infoBox.innerHTML = `Type:     Black Hole
BH ID:    ${bhData.bh_id}
Mass:     ${bhData.mass_msun.toFixed(2)} Msun
Position: (${bhData.x.toFixed(2)}, ${bhData.y.toFixed(2)}, ${bhData.z.toFixed(2)})
Velocity: (${bhData.vx.toFixed(2)}, ${bhData.vy.toFixed(2)}, ${bhData.vz.toFixed(2)})`;
                infoBox.style.display = 'block';
            } 
            else if (nsData) {
                infoBox.innerHTML = `Type:     Neutron Star
NS ID:    ${nsData.ns_id}
Mass:     ${nsData.mass_msun.toFixed(2)} Msun
Position: (${nsData.x.toFixed(2)}, ${nsData.y.toFixed(2)}, ${nsData.z.toFixed(2)})`;
                infoBox.style.display = 'block';
            }
        }
    } else {
        INTERSECTED = null;
        infoBox.style.display = 'none';
    }
}

function updateScaleBar() {
    const scaleBarLine = document.getElementById('scale-bar-line');
    const scaleBarLabel = document.getElementById('scale-bar-label');
    const worldDistance = 10;
    const cameraPosition = new THREE.Vector3();
    camera.getWorldPosition(cameraPosition);
    const distanceToOrigin = cameraPosition.length();
    const fov = THREE.MathUtils.degToRad(camera.fov);
    const visibleHeight = 2 * Math.tan(fov / 2) * distanceToOrigin;
    const visibleWidth = visibleHeight * camera.aspect;
    const pixelWidth = (worldDistance / visibleWidth) * window.innerWidth;
    scaleBarLine.style.width = pixelWidth + 'px';
    scaleBarLabel.textContent = `${worldDistance} pc`;
}

function animate() {
    requestAnimationFrame(animate);
    if (isPlaying) {
        frameCount++;
        if (frameCount >= framesPerUpdate) {
            frameCount = 0;
            const slider = document.getElementById('time-slider');
            let nextValue = parseInt(slider.value) + 1;
            if (nextValue >= Number(slider.max)) nextValue = 0;
            slider.value = nextValue;
            updateBlackHoles(nextValue);
        }
    }
    updateInfoBox();
    controls.update();
    updateScaleBar(); 
    renderer.render(scene, camera);
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

init();

Promise.all([
    loadData(),
    loadInteractionData(),
    loadNSData()
]).catch(err => console.error("Failed to load data:", err));