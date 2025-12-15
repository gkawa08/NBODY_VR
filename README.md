# NBODY_VR
**WebXR-enabled 3D visualization for astrophysical N-body simulations.**
Focusing on the dynamics of Black Holes (BH) and Neutron Stars (NS).

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
This tool is designed for detailed analysis of N-body simulation results.

* **Interactive Time Control**: Scrub through simulation time (`.Myr`) to observe evolution.
* **Reference Frames**: Toggle between the Simulation Frame and the **Center of Mass (CoM) Frame** to isolate binary dynamics.
* **Event Visualization**: Automatically highlights binary exchanges and mergers.
    * **Vector Visualization**: Real-time display of velocity and spin vectors during interactions.
* **Object Tracking**: Auto-follow specific particles or focus on interaction events.
* **Interactive Inspector**: Hover over any particle to view detailed properties (Mass, Position, Velocity, Spin Parameter).
* **High-Fidelity Visuals**: MeshPhysical materials for Black Holes and Emissive glowing effects for Neutron Stars.

---

## 🛠 Visualization Pipeline (Build with your Data)
You can visualize your own N-body simulation results by generating the required data format.

### 1. Data Generation
Run the following Python scripts/notebooks to convert your raw simulation data into visualization-ready CSV files.

| Step | Script | Output File | Function |
| :--- | :--- | :--- | :--- |
| **1** | **`BH_data_mp.py`** | `bh_history.csv` | Extracts Black Hole trajectories and time-series data. |
| **2** | **`NS_data_mp.py`** | `ns_history.csv` | Extracts Neutron Star trajectories and time-series data. |
| **3** | **`BH_all_data.ipynb`** | `bh_events.csv` | Analyzes interaction events (Mergers/Exchanges). |

> **Note:** Place the generated CSV files (`bh_history.csv`, etc.) into the **same directory** as `index.html` (the project root).

### 2. Local Development (WebXR Support)
To run the project locally with VR support, a secure context (HTTPS) is required because WebXR APIs are restricted on insecure origins.

**Generate SSL Certificate:**
```bash
openssl req -new -x509 -keyout localhost.pem -out localhost.pem -days 365 -nodes -subj "/C=JP/CN=localhost"
````

**Start Local Server:**
Using `http-server` (Node.js) is recommended to serve ES modules correctly.

```bash
http-server -S -C localhost.pem -K localhost.pem -p 8080
```

  * **Access**:
      * Desktop: `https://localhost:8080`
      * VR Headset: `https://<YOUR_LOCAL_IP>:8080` (Ensure your headset and PC are on the same network).

## Requirements

  * **Data Processing**: Python 3.x (pandas, numpy)
  * **Hosting**: Node.js / `http-server` (or any web server that supports HTTPS and ES Modules)
