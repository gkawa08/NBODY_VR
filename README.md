# NBODY_VR

WebXR-enabled 3D visualization for astrophysical N-body simulations (Black Holes & Neutron Stars).

## Data Generation
Prepare the required CSV files using your simulation scripts:

| Source Script | Output File | Description |
| :--- | :--- | :--- |
| **`BH_data_mp.py`** | `bh_history.csv` | Black Hole time series |
| **`NS_data_mp.py`** | `ns_history.csv` | Neutron Star time series |
| **`BH_all_data.ipynb`** | `bh_events.csv` | Interaction events (Mergers/Exchanges) |

## Quick Start

### 1. Generate SSL Certificate
Required for VR (WebXR) support. Run this in your project folder:

```bash
openssl req -new -x509 -keyout localhost.pem -out localhost.pem -days 365 -nodes -subj "/C=JP/CN=localhost"
```

### 2. Run Server

```bash
http-server -S -C localhost.pem -K localhost.pem -p 8080
```

## Access & Controls

* **Desktop**: `https://localhost:8080`
    * *Controls*: Left-click (Rotate), Right-click (Pan), Scroll (Zoom).
* **VR (Quest 2)**: `https://<YOUR_IP>:8080`
    * *Controls*: Controller sticks (Fly-through navigation).

## Features
* **Time Control**: Scrub through simulation time.
* **Events**: Visualize binary exchanges and mergers.
* **Tracking**: Auto-follow specific particles or events.
* **Visuals**: Shiny BHs (MeshPhysical) and glowing NSs (Emissive).
