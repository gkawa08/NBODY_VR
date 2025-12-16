# NBODY_VR

**WebXR-enabled 3D visualization for astrophysical N-body simulations.**
Focusing on the dynamics of Black Holes (BH) and Neutron Stars (NS) in dense star clusters.

https://github.com/user-attachments/assets/ad2e220e-3e62-41cc-b76f-5b5b09b94c66

---

## 🚀 Live Demo
You can experience the visualization directly in your browser. No installation required.

**[Launch NBODY_VR](https://gkawa08.github.io/NBODY_VR/)**

### Supported Devices
* **Desktop / Mobile**: Interactive 3D view.
    * *Controls*: Left-click (Rotate), Right-click (Pan), Scroll (Zoom).
* **VR Headsets (e.g., Meta Quest 2/3)**: Full immersive VR.
    * *How to start*: Access the link and click the **"ENTER VR"** button at the bottom of the screen.
    * *Controls*: Use controller sticks for fly-through navigation.

---

## ✨ Features
This tool is designed for detailed analysis of N-body simulation results (specifically **NBODY6** outputs).

* **Interactive Time Control**: Scrub through simulation time to observe dynamical evolution.
* **Reference Frames**: Toggle between the Simulation Frame and the **Center of Mass (CoM) Frame** to isolate binary dynamics.
* **Event Visualization**: Automatically highlights binary exchanges and mergers based on log data.
    * **Vector Visualization**: Real-time display of velocity and spin vectors during interactions.
* **Object Tracking**: Auto-follow specific particles or focus on interaction events.
* **Interactive Inspector**: Hover over any particle to view detailed properties (Mass, Position, Velocity, Spin Parameter).
* **High-Fidelity Visuals**: MeshPhysical materials for Black Holes and Emissive glowing effects for Neutron Stars.

---

## 🛠 Building form Scratch (Data Pipeline)
To visualize your own simulation data, you need to process the raw NBODY6 outputs into the format required by the web application.

### 1. Prerequisites
* **Simulation Output**: NBODY6 raw data.
    * `snapdata.hdf5` (Snapshot data)
    * `*_output.dat` (Log files for events)
* **Python Environment**: `numpy`, `pandas`, `h5py`, `tqdm`

### 2. Data Processing Steps
The repository includes scripts to extract trajectories and events.

> **Note:** Before running, edit the `hdf5_filepath` and `parent_dir` variables in the scripts to point to your local data.

| Step | Script | Input Data | Output File | Description |
| :--- | :--- | :--- | :--- | :--- |
| **1** | **`BH_data_mp.py`** | `snapdata.hdf5` | `bh_history.csv` | Extracts Black Hole trajectories (ID, Mass, Position, Velocity) using multiprocessing. |
| **2** | **`NS_data_mp.py`** | `snapdata.hdf5` | `ns_history.csv` | Extracts Neutron Star trajectories. |
| **3** | **`BH_all_data.ipynb`** | `*_output.dat` | `bh_events.csv` | Parses simulation logs to detect `EXCHANGE`, `ESCAPE`, and `MERGE` events. |

### 3. Deployment
Move the generated CSV files to the root directory of the web application.

1.  Place `bh_history.csv`, `ns_history.csv`, and `bh_events.csv` in the same folder as `index.html`.
2.  Run a local server (HTTPS is required for WebXR).

**Generate SSL Certificate (for localhost):**
```bash
openssl req -new -x509 -keyout localhost.pem -out localhost.pem -days 365 -nodes -subj "/C=JP/CN=localhost"
````

**Start Server:**

```bash
# Requires: npm install -g http-server
http-server -S -C localhost.pem -K localhost.pem -p 8080
```

  * **Access**: `https://localhost:8080`

## Requirements

  * **Data Processing**: Python 3.x
  * **Visualization**: WebGL-capable browser (Chrome/Edge/Firefox/Oculus Browser)

このREADMEであれば、専門家が見たときに「NBODY6のデータをHDF5経由で可視化しているんだな」と技術的な背景まで理解してもらえます。
```
