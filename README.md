# NBODY_VR
**WebXR-enabled 3D visualization for astrophysical N-body simulations.**
Focusing on the dynamics of Black Holes (BH) and Neutron Stars (NS).

![Demo Preview](docs/demo.gif)
*(Click the image above to watch the demo video)*

---

## 🚀 Live Demo
You can experience the visualization directly in your browser. No installation required.

**[Launch NBODY_VR](https://gkawa08.github.io/NBODY_VR/)**

### Supported Devices
* **Desktop / Mobile**: Interactive 3D view.
    * *Controls*: Left-click (Rotate), Right-click (Pan), Scroll (Zoom).
* **VR Headsets (e.g., Meta Quest 2/3)**: Full immersive VR.
    * *How to start*: Access the link and click the **"ENTER VR"** button at the bottom of the screen.
    * *Controls*: Controller sticks for fly-through navigation.

---

## ✨ Features
* **Interactive Time Control**: Scrub through simulation time to observe evolution.
* **Event Visualization**: Highlight binary exchanges and mergers automatically.
* **Object Tracking**: Auto-follow specific particles or interaction events.
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

> **Note:** Place the generated CSV files into the `assets/data/` directory.

### 2. Local Development (WebXR Support)
To run the project locally with VR support, a secure context (HTTPS) is required.

**Generate SSL Certificate:**
```bash
openssl req -new -x509 -keyout localhost.pem -out localhost.pem -days 365 -nodes -subj "/C=JP/CN=localhost"
````

**Start Local Server:**

```bash
http-server -S -C localhost.pem -K localhost.pem -p 8080
```

  * **Access**: `https://localhost:8080` (Desktop) or `https://<YOUR_LOCAL_IP>:8080` (VR Headset)

## Requirements

  * Python 3.x (for data processing)
      * pandas, numpy, etc.
  * Node.js / `http-server` (for local hosting)
