import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
// VR Support: Import VRButton
import { VRButton } from 'three/addons/webxr/VRButton.js';

// --- Configuration ---
const G = 4.4985e-3; // Gravitational constant in pc^3 / (M_sun * Myr^2)
const SIMULATION_BOUNDS = 40; 
const PSEUDO_SPIN_PARAMETER_A = 0.6; // Dimensionless spin parameter (0 to 1)
const SPIN_VECTOR_SCALE = 0.001;      // Visual scaling factor for spin vectors

// --- Global variables ---
let scene, camera, renderer, controls, cubeFrame, cameraRig; 
let clock; // Time tracking for smooth animation independent of frame rate

const bhObjects = new Map();
let timeData = new Map();
let timeKeys = [];
let isPlaying = false;
let frameCount = 0;
let framesPerUpdate = 11;
let isCameraTracking = true;
let particleSizeMultiplier = 1.0; 
let useComFrame = false;
let cameraTargetGoal = new THREE.Vector3(0, 0, 0);

// Data structures for visual elements
const ellipseObjects = new Map(); 
const velocityVectors = new Map();
const spinRings = new Map();
const eventVectors = []; 

// --- Color Constants ---
const DEFAULT_COLOR = new THREE.Color(0x050505);
const BINARY_PARTICLE_COLOR = new THREE.Color(0x00ff00);
const INTERLOPER_PARTICLE_COLOR = new THREE.Color(0xff0000);
const HIGHLIGHT_COLOR = new THREE.Color(0xffff00);

const PRE_EXCHANGE_ORBIT_COLOR = new THREE.Color(0x00ff00);
const POST_EVENT_COLOR = new THREE.Color(0xff00ff);
const VECTOR_COLOR = 0x0000ff;
const KICK_VECTOR_COLOR = 0xff0000;       // Red for the final kick
const COM_VELOCITY_COLOR = 0x00ffff;     // Cyan for pre-merger CoM velocity
const SPIN_VECTOR_COLOR = 0xff00ff;      // Magenta for spin vectors

let raycaster;
let mouse;
let INTERSECTED; 

let interactionEvents = [];
let selectedEvent = null;
let highlightedBhId = null;

let nsData = new Map();
const nsObjects = new Map();

// --- Helper Functions for Memory Management ---
// IMPORTANT: Three.js requires manual disposal of geometries and materials to prevent memory leaks.

function cleanupObject(object) {
    if (!object) return;
    // Dispose geometry
    if (object.geometry) object.geometry.dispose();
    // Dispose material(s)
    if (object.material) {
        if (Array.isArray(object.material)) {
            object.material.forEach(material => material.dispose());
        } else {
            object.material.dispose();
        }
    }
    // Remove from scene
    scene.remove(object);
}

function cleanupMap(mapObject) {
    mapObject.forEach(obj => cleanupObject(obj));
    mapObject.clear();
}

function cleanupArray(arrayObject) {
    arrayObject.forEach(obj => cleanupObject(obj));
    arrayObject.length = 0;
}

// --- Initialization ---
function init() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0xdddddd);
    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(SIMULATION_BOUNDS * 0.7, SIMULATION_BOUNDS * 0.7, SIMULATION_BOUNDS * 0.7);
    camera.lookAt(0, 0, 0);
    
    // Initialize clock for delta time calculation
    clock = new THREE.Clock();

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);

    // VR Setup: Enable XR on renderer
    renderer.xr.enabled = true; 
    
    document.body.appendChild(renderer.domElement);
    document.body.appendChild(VRButton.createButton(renderer));

    // VR Camera Rig: Group to hold the camera for VR offset manipulation
    cameraRig = new THREE.Group();
    cameraRig.add(camera);
    scene.add(cameraRig);

    renderer.xr.addEventListener('sessionstart', onSessionStart);
    
    // Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
    scene.add(ambientLight);
    const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
    directionalLight.position.set(1, 1, 1);
    scene.add(directionalLight);
    
    // Controls: OrbitControls for Desktop (Mouse) interaction
    controls = new OrbitControls(camera, renderer.domElement);
    controls.maxDistance = 200;
    controls.minDistance = 0.1;
    controls.enableDamping = true;
    controls.dampingFactor = 0.1;
    controls.dollyToCursor = false;
    
    raycaster = new THREE.Raycaster();
    mouse = new THREE.Vector2();
    
    window.addEventListener('resize', onWindowResize, false);
    document.addEventListener('mousemove', onDocumentMouseMove, false);
    
    setupUI();
    addCubeFrame();

    // Main Loop: Use setAnimationLoop for VR compatibility instead of requestAnimationFrame
    renderer.setAnimationLoop(animate);
}

function addCubeFrame() {
    const geometry = new THREE.BoxGeometry(SIMULATION_BOUNDS * 2, SIMULATION_BOUNDS * 2, SIMULATION_BOUNDS * 2);
    const edges = new THREE.EdgesGeometry(geometry);
    cubeFrame = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0x888888 }));
    scene.add(cubeFrame);
}

// --- Data Parsing & Loading ---

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
    try {
        const response = await fetch('bh_events.csv');
        const csvData = await response.text();
        const rows = csvData.trim().split('\n');
        const headers = rows.shift().split(',').map(h => h.trim());
        interactionEvents = [];
        for (const row of rows) {
            const rowData = parseCsvRow(row, headers);
            const { event_list, id1_list, id2_list, id3_list, id4_list, time_list } = rowData;

            if (event_list === 'EXCHANGE' && id1_list && id2_list && id3_list && id4_list) {
                 interactionEvents.push({ 
                     type: 'EXCHANGE',
                     time: time_list, 
                     id1: id1_list, id2: id2_list, 
                     id3: id3_list, id4: id4_list 
                 });
            } else if (event_list === 'MERGE' && id1_list && id2_list) {
                interactionEvents.push({
                    type: 'MERGE',
                    time: time_list,
                    id1: id1_list, id2: id2_list,
                });
            }
        }
        populateEventSelector();
    } catch (e) { console.warn("Could not load bh_events.csv", e); }
}

async function loadData() {
    try {
        const response = await fetch('bh_history.csv');
        const textData = await response.text();
        const rows = textData.trim().split('\n');
        const headers = rows.shift().split(',');
        for (const row of rows) {
            const rowData = parseCsvRow(row, headers);
            const time = rowData.time_myr;
            if (time === null || isNaN(time)) continue;
            if (!timeData.has(time)) timeData.set(time, []);
            timeData.get(time).push(rowData);
        }
        timeKeys = Array.from(timeData.keys()).sort((a, b) => a - b);
        document.getElementById('time-slider').max = timeKeys.length - 1;
        updateBlackHoles(0);
    } catch (e) { console.error("Failed to load bh_history.csv", e); }
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
            if (!nsData.has(time)) nsData.set(time, []);
            nsData.get(time).push(rowData);
        }
    } catch (e) { console.warn("Could not load ns_history.csv."); }
}

// --- Core Update Logic ---

function updateBlackHoles(timeIndex) {
    if (timeIndex >= timeKeys.length) return;
    const time = timeKeys[timeIndex];
    const bhData = timeData.get(time);
    
    // Update UI
    document.getElementById('time-slider').value = timeIndex;
    document.getElementById('time-label').textContent = `${time.toFixed(2)} Myr`;

    // Clean up temporary vectors/lines from previous frame to avoid memory leaks
    cleanupArray(eventVectors);

    // Center of Mass (CoM) Calculation
    const comOffset = new THREE.Vector3(0, 0, 0);
    if (useComFrame) {
        let totalMass = 0;
        const com = new THREE.Vector3(0, 0, 0);
        const allParticles = [...bhData, ...(nsData.get(time) || [])];

        for (const p of allParticles) {
            if (p.mass_msun) {
                totalMass += p.mass_msun;
                com.x += p.x * p.mass_msun;
                com.y += p.y * p.mass_msun;
                com.z += p.z * p.mass_msun;
            }
        }
        if (totalMass > 0) com.divideScalar(totalMass);
        comOffset.copy(com);
    }
    // Shift the reference frame box relative to the particles
    cubeFrame.position.copy(comOffset).negate();

    // Remove BHs that are no longer in the current time step
    const visibleBhIds = new Set(bhData.map(bh => bh.bh_id));
    for (const [bhId, obj] of bhObjects.entries()) {
        if (!visibleBhIds.has(bhId)) {
            cleanupObject(obj); // Dispose geometry/material
            bhObjects.delete(bhId);
        }
    }

    // Clean up visual elements before redrawing
    cleanupMap(spinRings);
    cleanupMap(ellipseObjects);
    cleanupMap(velocityVectors);

    // Update or create BH spheres
    bhData.forEach(bh => getOrCreateBHSphere(bh, comOffset));

    // Handle Event Visualization
    if (selectedEvent) {
        if (selectedEvent.type === 'EXCHANGE') {
            handleExchangeEvent(time, bhData, comOffset);
        } else if (selectedEvent.type === 'MERGE') {
            handleMergeEvent(time, bhData, comOffset);
        }
    } else {
        // Reset colors if no event is selected
        bhObjects.forEach(sphere => {
            sphere.material.color.set(DEFAULT_COLOR);
            sphere.material.opacity = 1.0;
        });
    }

    // Handle Highlights
    if (highlightedBhId !== null) {
        const highlightedSphere = bhObjects.get(highlightedBhId);
        if (highlightedSphere) {
            highlightedSphere.material.color.set(HIGHLIGHT_COLOR);
            highlightedSphere.material.opacity = 1.0;
        }
    }
    
    // Camera Tracking Logic (Smooth transition)
    // Only track if enabled AND not in VR mode (VR uses headset position)
    if (isCameraTracking && !renderer.xr.isPresenting) {
        let targetPosition = null;
        let trackedObject = null;
        
        // Priority: Highlighted BH -> Selected Event -> Origin
        if (highlightedBhId !== null) {
            trackedObject = bhObjects.get(highlightedBhId);
        }
        
        if (trackedObject) {
            targetPosition = trackedObject.position;
        } else if (selectedEvent) {
            // Determine which actors to track based on event phase
            let actorIdsToTrack = [];
            if (selectedEvent.type === 'EXCHANGE') {
                actorIdsToTrack = [selectedEvent.id1, selectedEvent.id2, selectedEvent.id3, selectedEvent.id4];
            } else if (selectedEvent.type === 'MERGE') {
                if (time < selectedEvent.time) {
                    actorIdsToTrack = [selectedEvent.id1, selectedEvent.id2];
                } else {
                    // Post-merger tracking
                    const currentBhIds = new Set(bhData.map(bh => bh.bh_id));
                    let remnantId = null;
                    if (currentBhIds.has(selectedEvent.id1)) remnantId = selectedEvent.id1;
                    else if (currentBhIds.has(selectedEvent.id2)) remnantId = selectedEvent.id2;
                    
                    if (remnantId !== null) actorIdsToTrack = [remnantId];
                }
            }
            
            // Calculate average position of relevant actors
            const allActors = [];
            new Set(actorIdsToTrack).forEach(id => {
                const obj = bhObjects.get(id);
                if(obj) allActors.push(obj);
            });

            const actorsInBounds = allActors.filter(actor => actor.position.length() < SIMULATION_BOUNDS);

            if (actorsInBounds.length > 0) {
                targetPosition = new THREE.Vector3();
                actorsInBounds.forEach(obj => targetPosition.add(obj.position));
                targetPosition.divideScalar(actorsInBounds.length);
            }
        }
        
        // Smoothly lerp camera target
        if (targetPosition) {
            cameraTargetGoal.lerp(targetPosition, 0.1);
        } else {
            cameraTargetGoal.lerp(new THREE.Vector3(0, 0, 0), 0.1);
        }
    }
    
    updateNSObjects(time, comOffset);
}

// --- Event Handling Specifics ---

function handleExchangeEvent(time, bhData, comOffset) {
    const { time: eventTime, id1, id2, id3, id4 } = selectedEvent;
    const originalBinaryIds = new Set([id1, id2]);
    const newBinaryIds = new Set([id3, id4]);
    const interloperId = [...newBinaryIds].find(id => !originalBinaryIds.has(id));
    const ejectedId = [...originalBinaryIds].find(id => !newBinaryIds.has(id));
    const allActorIds = new Set([id1, id2, id3, id4]);

    // Dim unrelated particles
    bhObjects.forEach((sphere, bhId) => {
        if (!allActorIds.has(bhId)) {
            sphere.material.color.set(DEFAULT_COLOR);
            sphere.material.opacity = 0.1;
        } else {
            sphere.material.opacity = 1.0;
            if (originalBinaryIds.has(bhId)) sphere.material.color.set(BINARY_PARTICLE_COLOR);
            else if (bhId === interloperId) sphere.material.color.set(INTERLOPER_PARTICLE_COLOR);
            else sphere.material.color.set(DEFAULT_COLOR);
        }
    });

    // Draw orbits based on phase (Pre or Post exchange)
    if (time < eventTime) {
        drawIndividualOrbitsForPair(id1, id2, bhData, PRE_EXCHANGE_ORBIT_COLOR, comOffset);
        drawVelocityVector(interloperId, bhData);
    } else {
        drawIndividualOrbitsForPair(id3, id4, bhData, POST_EVENT_COLOR, comOffset);
        drawVelocityVector(ejectedId, bhData);
    }
}

function handleMergeEvent(time, bhData, comOffset) {
    const { time: eventTime, id1, id2 } = selectedEvent;
    const preMergeIds = new Set([id1, id2]);
    
    let remnantId = null;
    if (time >= eventTime) {
        const currentBhIds = new Set(bhData.map(bh => bh.bh_id));
        if (currentBhIds.has(id1)) remnantId = id1;
        else if (currentBhIds.has(id2)) remnantId = id2;
    }
    
    const allActorIds = new Set([id1, id2]);
    if (remnantId) allActorIds.add(remnantId);

    // Dim unrelated particles
    bhObjects.forEach((sphere, bhId) => {
        if (!allActorIds.has(bhId)) {
             sphere.material.opacity = 0.1;
        } else {
            sphere.material.opacity = 1.0;
            if (time < eventTime) {
                if (preMergeIds.has(bhId)) sphere.material.color.set(BINARY_PARTICLE_COLOR);
            } else {
                if (bhId === remnantId) sphere.material.color.set(POST_EVENT_COLOR);
                else sphere.material.opacity = 0.1;
            }
        }
    });

    if (time < eventTime) {
        drawIndividualOrbitsForPair(id1, id2, bhData, PRE_EXCHANGE_ORBIT_COLOR, comOffset);
        
        // Calculate CoM and Spins for visual reference
        const bh1Data = bhData.find(bh => bh.bh_id === id1);
        const bh2Data = bhData.find(bh => bh.bh_id === id2);

        if (bh1Data && bh2Data) {
            const m1 = bh1Data.mass_msun, m2 = bh2Data.mass_msun;
            const p1 = new THREE.Vector3(bh1Data.x, bh1Data.y, bh1Data.z);
            const p2 = new THREE.Vector3(bh2Data.x, bh2Data.y, bh2Data.z);
            const v1 = new THREE.Vector3(bh1Data.vx, bh1Data.vy, bh1Data.vz);
            const v2 = new THREE.Vector3(bh2Data.vx, bh2Data.vy, bh2Data.vz);

            const comPos = p1.clone().multiplyScalar(m1).add(p2.clone().multiplyScalar(m2)).divideScalar(m1 + m2);
            const comVel = v1.clone().multiplyScalar(m1).add(v2.clone().multiplyScalar(m2)).divideScalar(m1 + m2);
            drawVector(comPos.sub(comOffset), comVel, comVel.length() * 0.5, COM_VELOCITY_COLOR);

            // Calculate orbital angular momentum direction for pseudo-spin visualization
            const r_rel = new THREE.Vector3().subVectors(p1, p2);
            const v_rel = new THREE.Vector3().subVectors(v1, v2);
            const orbitalAxis = new THREE.Vector3().crossVectors(r_rel, v_rel).normalize();
            
            const spinDir1 = orbitalAxis.clone();
            const spinDir2 = orbitalAxis.clone();
            
            const spinMag1 = SPIN_VECTOR_SCALE * PSEUDO_SPIN_PARAMETER_A * m1 * m1;
            const spinMag2 = SPIN_VECTOR_SCALE * PSEUDO_SPIN_PARAMETER_A * m2 * m2;

            drawVector(p1.clone().sub(comOffset), spinDir1, spinMag1, SPIN_VECTOR_COLOR);
            drawVector(p2.clone().sub(comOffset), spinDir2, spinMag2, SPIN_VECTOR_COLOR);
        }

    } else { // After merge
        if (remnantId !== null) {
            drawVelocityVector(remnantId, bhData, KICK_VECTOR_COLOR, 0.5);

            // Retroactively calculate spin from pre-merger state
            const eventTimeIndex = timeKeys.findIndex(t => t >= eventTime);
            const preMergeTimeKey = timeKeys[eventTimeIndex - 1];

            if (preMergeTimeKey) {
                const preMergeBhData = timeData.get(preMergeTimeKey);
                const bh1Data = preMergeBhData.find(bh => bh.bh_id === id1);
                const bh2Data = preMergeBhData.find(bh => bh.bh_id === id2);
                const remnantData = bhData.find(bh => bh.bh_id === remnantId);

                if (bh1Data && bh2Data && remnantData) {
                    const m1 = bh1Data.mass_msun, m2 = bh2Data.mass_msun;
                    const p1 = new THREE.Vector3(bh1Data.x, bh1Data.y, bh1Data.z);
                    const p2 = new THREE.Vector3(bh2Data.x, bh2Data.y, bh2Data.z);
                    const v1 = new THREE.Vector3(bh1Data.vx, bh1Data.vy, bh1Data.vz);
                    const v2 = new THREE.Vector3(bh2Data.vx, bh2Data.vy, bh2Data.vz);

                    const r_rel_pre = new THREE.Vector3().subVectors(p1, p2);
                    const v_rel_pre = new THREE.Vector3().subVectors(v1, v2);
                    const orbitalAxis_pre = new THREE.Vector3().crossVectors(r_rel_pre, v_rel_pre).normalize();
                    const s1_dir = orbitalAxis_pre.clone();
                    const s2_dir = orbitalAxis_pre.clone();
                    
                    const s1_mag = SPIN_VECTOR_SCALE * PSEUDO_SPIN_PARAMETER_A * m1 * m1;
                    const s2_mag = SPIN_VECTOR_SCALE * PSEUDO_SPIN_PARAMETER_A * m2 * m2;
                    const S1 = s1_dir.multiplyScalar(s1_mag);
                    const S2 = s2_dir.multiplyScalar(s2_mag);

                    const mu = (m1 * m2) / (m1 + m2);
                    const L_orb = new THREE.Vector3().crossVectors(r_rel_pre, v_rel_pre.clone().multiplyScalar(mu));
                    
                    const S_final = new THREE.Vector3().add(S1).add(S2).add(L_orb.multiplyScalar(SPIN_VECTOR_SCALE * 0.1));
                    
                    const remnantPos = new THREE.Vector3(remnantData.x, remnantData.y, remnantData.z);
                    drawVector(remnantPos.sub(comOffset), S_final.clone().normalize(), S_final.length(), SPIN_VECTOR_COLOR);

                    const M_final = remnantData.mass_msun;
                    let a_final = S_final.length() / (SPIN_VECTOR_SCALE * M_final * M_final);
                    a_final = Math.min(1.0, a_final);
                    
                    const remnantObject = bhObjects.get(remnantId);
                    if (remnantObject) {
                        remnantObject.userData.spinParameterA = a_final;
                    }
                }
            }
        }
    }
}

// --- Drawing Helpers ---

function drawVelocityVector(bhId, bhData, color = VECTOR_COLOR, scale = 0.1) {
    if (bhId === null || bhId === undefined) return;

    const targetBhData = bhData.find(bh => bh.bh_id === bhId);
    const targetBhObject = bhObjects.get(bhId);

    if (targetBhData && targetBhObject) {
        const origin = targetBhObject.position;
        const velocity = new THREE.Vector3(targetBhData.vx, targetBhData.vy, targetBhData.vz);
        const speed = velocity.length();

        if (speed > 0) {
            drawVector(origin, velocity, speed * scale, color);
        }
    }
}

function drawVector(origin, direction, length, color) {
    if (length <= 1e-6 || !direction || isNaN(direction.x)) return;
    const dir = direction.clone().normalize();
    const arrowHelper = new THREE.ArrowHelper(dir, origin, length, color);
    scene.add(arrowHelper);
    eventVectors.push(arrowHelper); // Track for cleanup
}

function getOrCreateBHSphere(bh, comOffset) {
    let sphere = bhObjects.get(bh.bh_id);
    if (!sphere) {
        const geometry = new THREE.SphereGeometry(0.2, 32, 32);
        const material = new THREE.MeshStandardMaterial({ color: DEFAULT_COLOR, transparent: true, opacity: 1.0 });
        sphere = new THREE.Mesh(geometry, material);
        bhObjects.set(bh.bh_id, sphere);
        scene.add(sphere);
    }
    sphere.userData.bhData = bh;
    delete sphere.userData.spinParameterA; 
    sphere.position.set(bh.x - comOffset.x, bh.y - comOffset.y, bh.z - comOffset.z);
    sphere.scale.set(particleSizeMultiplier, particleSizeMultiplier, particleSizeMultiplier);
    sphere.material.color.set(DEFAULT_COLOR);
    sphere.visible = true;
    return sphere;
}

function drawIndividualOrbitsForPair(bhId1, bhId2, allBhData, color, comOffset) {
    const bh1 = allBhData.find(bh => bh.bh_id === bhId1);
    const bh2 = allBhData.find(bh => bh.bh_id === bhId2);
    if (!bh1 || !bh2) return;

    // Calculation for Keplerian Orbit
    const m1 = bh1.mass_msun, m2 = bh2.mass_msun;
    const M_total = m1 + m2;
    const r1_vec = new THREE.Vector3(bh1.x, bh1.y, bh1.z), r2_vec = new THREE.Vector3(bh2.x, bh2.y, bh2.z);
    const v1_vec = new THREE.Vector3(bh1.vx, bh1.vy, bh1.vz), v2_vec = new THREE.Vector3(bh2.vx, bh2.vy, bh2.vz);
    
    const r_rel = new THREE.Vector3().subVectors(r1_vec, r2_vec);
    if (r_rel.length() === 0) return;
    const v_rel = new THREE.Vector3().subVectors(v1_vec, v2_vec);
    
    const reduced_mass = (m1 * m2) / M_total;
    const E_bin = 0.5 * reduced_mass * v_rel.lengthSq() - (G * m1 * m2 / r_rel.length());

    if (E_bin < 0) {
        // Bound system: Calculate orbital elements
        const mu_param = G * M_total;
        const h_vec = new THREE.Vector3().crossVectors(r_rel, v_rel);
        const e_vec = new THREE.Vector3().crossVectors(v_rel, h_vec).divideScalar(mu_param).sub(r_rel.clone().normalize());
        const e = e_vec.length();

        if (e < 1) {
            const a_rel = -G * m1 * m2 / (2 * E_bin);
            const b_rel = a_rel * Math.sqrt(1 - e * e);
            const center_of_mass = new THREE.Vector3().addVectors(r1_vec.clone().multiplyScalar(m1), r2_vec.clone().multiplyScalar(m2)).divideScalar(M_total);

            if (a_rel > 0 && b_rel > 0 && isFinite(a_rel) && isFinite(b_rel)) {
                const normal = h_vec.clone().normalize();
                const quaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
                
                // Helper to draw one ellipse
                const createOrbitEllipse = (semiMajor, semiMinor, eccentricity, rotationAngle) => {
                    const focusOffset = semiMajor * eccentricity;
                    const curve = new THREE.EllipseCurve(-focusOffset, 0, semiMajor, semiMinor, 0, 2 * Math.PI, false, 0);
                    const points = curve.getPoints(100);
                    const geometry = new THREE.BufferGeometry().setFromPoints(points);
                    const material = new THREE.LineBasicMaterial({ color: color });
                    const ellipseLine = new THREE.Line(geometry, material);

                    ellipseLine.position.copy(center_of_mass).sub(comOffset);
                    ellipseLine.quaternion.copy(quaternion);
                    ellipseLine.rotateOnAxis(new THREE.Vector3(0, 0, 1), rotationAngle);
                    
                    scene.add(ellipseLine);
                    return ellipseLine;
                };

                const localX = new THREE.Vector3(1, 0, 0).applyQuaternion(quaternion);
                const angle = localX.angleTo(e_vec);
                const cross = new THREE.Vector3().crossVectors(localX, e_vec);
                const sign = Math.sign(normal.dot(cross));
                const baseAngle = angle * sign;

                const scale1 = m2 / M_total;
                const scale2 = m1 / M_total;

                const ellipse1 = createOrbitEllipse(a_rel * scale1, b_rel * scale1, e, baseAngle);
                const ellipse2 = createOrbitEllipse(a_rel * scale2, b_rel * scale2, e, baseAngle + Math.PI);

                const pairId = Math.min(bhId1, bhId2) + '-' + Math.max(bhId1, bhId2);
                ellipseObjects.set(pairId + '-1', ellipse1);
                ellipseObjects.set(pairId + '-2', ellipse2);
            }
        }
    }
}


function updateNSObjects(time, comOffset) {
    const currentNSs = nsData.get(time) || [];
    const visibleNsIds = new Set(currentNSs.map(ns => ns.ns_id));

    // Clean up missing NS objects to prevent memory leaks
    for (const [nsId, obj] of nsObjects.entries()) {
        if (!visibleNsIds.has(nsId)) {
            cleanupObject(obj);
            nsObjects.delete(nsId);
        }
    }

    currentNSs.forEach(ns => {
        let sphere = nsObjects.get(ns.ns_id);
        if (!sphere) {
            const geometry = new THREE.SphereGeometry(0.15, 16, 16);
            const material = new THREE.MeshStandardMaterial({ color: 0xffa500, transparent: true, opacity: 0.5 });
            sphere = new THREE.Mesh(geometry, material);
            nsObjects.set(ns.ns_id, sphere);
            scene.add(sphere);
        }
        sphere.userData.nsData = ns;
        sphere.position.set(ns.x - comOffset.x, ns.y - comOffset.y, ns.z - comOffset.z);
        sphere.scale.set(particleSizeMultiplier * 0.7, particleSizeMultiplier * 0.7, particleSizeMultiplier * 0.7);
        sphere.visible = document.getElementById('ns-visible-checkbox').checked;
    });
}

// --- UI Functions ---

function populateEventSelector() {
    const select = document.getElementById('interaction-event-select');
    select.innerHTML = '';
    const defaultOption = document.createElement('option');
    defaultOption.value = -1;
    defaultOption.textContent = 'None';
    select.appendChild(defaultOption);

    interactionEvents.forEach((event, index) => {
        const option = document.createElement('option');
        option.value = index;
        if (event.type === 'EXCHANGE') {
            option.textContent = `Exchange @ ${event.time.toFixed(0)}: (${event.id1}, ${event.id2}) -> (${event.id3}, ${event.id4})`;
        } else if (event.type === 'MERGE') {
            option.textContent = `Merge @ ${event.time.toFixed(0)}: (${event.id1}, ${event.id2})`;
        }
        select.appendChild(option);
    });
}

function setupUI() {
    const playPauseBtn = document.getElementById('play-pause-btn');
    const slider = document.getElementById('time-slider');
    const speedSlider = document.getElementById('speed-slider');
    const bhSizeSlider = document.getElementById('bh-size-slider');
    const nsVisibleCheckbox = document.getElementById('ns-visible-checkbox');
    const eventSelect = document.getElementById('interaction-event-select');
    const cameraTrackCheckbox = document.getElementById('camera-track-checkbox');
    const highlightBhInput = document.getElementById('highlight-bh-input');
    const clearHighlightBtn = document.getElementById('clear-highlight-btn');
    const comFrameCheckbox = document.getElementById('com-frame-checkbox');

    particleSizeMultiplier = parseFloat(bhSizeSlider.value) * 0.01;

    // Prevent OrbitControls from interfering with UI interaction
    const uiControls = document.getElementById('ui-controls');
    const stopPropagation = (event) => event.stopPropagation();
    ['pointerdown', 'pointermove', 'pointerup', 'wheel'].forEach(evt => uiControls.addEventListener(evt, stopPropagation));

    playPauseBtn.addEventListener('click', () => {
        isPlaying = !isPlaying;
        playPauseBtn.textContent = isPlaying ? 'Pause' : 'Play';
    });
    
    slider.addEventListener('mousedown', () => { if (isPlaying) { isPlaying = false; playPauseBtn.textContent = 'Play'; } });
    slider.addEventListener('input', e => updateBlackHoles(parseInt(e.target.value)));
    
    speedSlider.addEventListener('input', e => { framesPerUpdate = 21 - parseInt(e.target.value); });
    
    cameraTrackCheckbox.addEventListener('change', e => { 
        isCameraTracking = e.target.checked; 
        if (!isCameraTracking) {
            cameraTargetGoal.copy(controls.target);
        }
    });
    nsVisibleCheckbox.addEventListener('change', e => { nsObjects.forEach(s => s.visible = e.target.checked); });

    bhSizeSlider.addEventListener('input', e => {
        particleSizeMultiplier = parseFloat(e.target.value) * 0.01;
        bhObjects.forEach(s => s.scale.set(particleSizeMultiplier, particleSizeMultiplier, particleSizeMultiplier));
        nsObjects.forEach(s => s.scale.set(particleSizeMultiplier * 0.7, particleSizeMultiplier * 0.7, particleSizeMultiplier * 0.7));
    });

    eventSelect.addEventListener('change', (e) => {
        const selectedIndex = parseInt(e.target.value);
        selectedEvent = (selectedIndex === -1) ? null : interactionEvents[selectedIndex];
        if (selectedEvent) {
            // Jump time to slightly before event
            const targetTime = selectedEvent.time - 1000;
            const closestTimeIndex = timeKeys.reduce((prev, curr, i) => (Math.abs(curr - targetTime) < Math.abs(timeKeys[prev] - targetTime) ? i : prev), 0);
            slider.value = closestTimeIndex;
        }
        updateBlackHoles(parseInt(slider.value));
    });

    highlightBhInput.addEventListener('input', () => {
        const id = parseInt(highlightBhInput.value, 10);
        highlightedBhId = isNaN(id) ? null : id;
        updateBlackHoles(parseInt(slider.value));
    });

    clearHighlightBtn.addEventListener('click', () => {
        highlightBhInput.value = '';
        highlightedBhId = null;
        updateBlackHoles(parseInt(slider.value));
    });

    comFrameCheckbox.addEventListener('change', (e) => {
        useComFrame = e.target.checked;
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
    const intersects = raycaster.intersectObjects(intersectableObjects.filter(o => o.visible && o.material.opacity > 0.05));
    const infoBox = document.getElementById('tracking-info');

    if (intersects.length > 0) {
        INTERSECTED = intersects[0].object;
        const data = INTERSECTED.userData.bhData || INTERSECTED.userData.nsData;
        let infoText = '';
        if (data.bh_id !== undefined) {
            infoText = `Type:     Black Hole\nBH ID:    ${data.bh_id}\nMass:     ${data.mass_msun.toFixed(2)} Msun\nPosition: (${data.x.toFixed(2)}, ${data.y.toFixed(2)}, ${data.z.toFixed(2)})\nVelocity: (${data.vx.toFixed(2)}, ${data.vy.toFixed(2)}, ${data.vz.toFixed(2)})`;
            
            const spinParam = INTERSECTED.userData.spinParameterA;
            if (spinParam !== undefined) {
                infoText += `\nSpin (a): ${spinParam.toFixed(3)}`;
            }

        } else if (data.ns_id !== undefined) {
            infoText = `Type:     Neutron Star\nNS ID:    ${data.ns_id}\nMass:     ${data.mass_msun.toFixed(2)} Msun\nPosition: (${data.x.toFixed(2)}, ${data.y.toFixed(2)}, ${data.z.toFixed(2)})`;
        }
        infoBox.innerHTML = infoText;
        infoBox.style.display = 'block';
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
    const pixelWidth = (worldDistance / (visibleHeight * camera.aspect)) * window.innerWidth;
    scaleBarLine.style.width = `${pixelWidth}px`;
    scaleBarLabel.textContent = `${worldDistance} pc`;
}

function animate() {
    const deltaTime = clock.getDelta();

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

    // VR Controller Interaction Logic
    if (renderer.xr.isPresenting) {
        // Logic for moving the camera with VR controllers (e.g., Oculus Quest)
        const controller = renderer.xr.getController(0);

        if (controller && controller.gamepad) {
            // Typically axis 3 is the vertical stick movement
            const stickY = controller.gamepad.axes[3] || 0;

            if (Math.abs(stickY) > 0.1) {
                const cameraDirection = new THREE.Vector3();
                camera.getWorldDirection(cameraDirection);
                const speed = 2.0; 
                
                // Move the Camera Rig, not the camera itself
                cameraRig.position.addScaledVector(cameraDirection, -stickY * speed * deltaTime);
            }
        }
    } else {
        // Desktop Mode: Update OrbitControls
        if (isCameraTracking) {
            controls.target.lerp(cameraTargetGoal, 0.1);
        }
        controls.update();
    }
    
    updateInfoBox();
    updateScaleBar();
    renderer.render(scene, camera);
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

function onSessionStart() {
    // Sync VR rig position with current desktop camera position
    const nonVrCameraPosition = new THREE.Vector3();
    const nonVrCameraQuaternion = new THREE.Quaternion();
    camera.getWorldPosition(nonVrCameraPosition);
    camera.getWorldQuaternion(nonVrCameraQuaternion);

    cameraRig.position.copy(nonVrCameraPosition);
    
    // Align rotation (Yaw only)
    const euler = new THREE.Euler().setFromQuaternion(nonVrCameraQuaternion, 'YXZ');
    euler.x = 0; 
    euler.z = 0; 
    cameraRig.quaternion.setFromEuler(euler);

    camera.position.set(0, 0, 0);
    camera.quaternion.identity();
}

// --- Execution Start ---
init();

Promise.all([
    loadData(),
    loadInteractionData(),
    loadNSData()
]).catch(err => console.error("Failed to load data:", err));