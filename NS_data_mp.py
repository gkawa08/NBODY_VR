import h5py
import re
import numpy as np
import pandas as pd
from tqdm import tqdm
from multiprocessing import Pool
import os

def process_snapshot(args):
    hdf5_filepath, key, NS_KW_TYPE, MASS_CONVERSION_FACTOR = args
    ns_records = []

    with h5py.File(hdf5_filepath, 'r') as f_h5:
        if key not in f_h5 or not isinstance(f_h5[key], h5py.Group):
            return ns_records
            
        data = f_h5[key]

        if 't' not in data or 'kw' not in data:
            return ns_records

        time = data['t'][()]
        kw_types = data['kw'][()]
        ns_mask = (kw_types == NS_KW_TYPE)
        num_ns = np.sum(ns_mask)

        if num_ns > 0:
            ids = data['id'][()]
            masses = data['m'][()]
            vxs = data['vx'][()]
            vys = data['vy'][()]
            vzs = data['vz'][()]
            xs = data['x'][()]
            ys = data['y'][()]
            zs = data['z'][()]

            ns_ids = ids[ns_mask]
            ns_masses = masses[ns_mask] * MASS_CONVERSION_FACTOR
            ns_vxs = vxs[ns_mask]
            ns_vys = vys[ns_mask]
            ns_vzs = vzs[ns_mask]
            ns_xs = xs[ns_mask]
            ns_ys = ys[ns_mask]
            ns_zs = zs[ns_mask]

            for i in range(num_ns):
                record = {
                    'time_myr': time,
                    'ns_id': ns_ids[i],
                    'mass_msun': ns_masses[i],
                    'vx': ns_vxs[i],
                    'vy': ns_vys[i],
                    'vz': ns_vzs[i],
                    'x': ns_xs[i],
                    'y': ns_ys[i],
                    'z': ns_zs[i],
                }
                ns_records.append(record)
                
    return ns_records

if __name__ == "__main__":
    
    hdf5_filepath = '/Volumes/Kingcess/NBODY6/snapdata.hdf5'
    NS_KW_TYPE = 13
    MASS_CONVERSION_FACTOR = 127918.2 
    output_csv_filename = 'ns_history.csv'

    try:
        with h5py.File(hdf5_filepath, 'r') as f_h5:
            snap_keys = list(f_h5.keys())
    except IOError:
        print(f"Error: Cannot open HDF5 file at {hdf5_filepath}")
        exit()

    def get_snap_number(key):
        match = re.match(r'snap_(\d+)', key)
        return int(match.group(1)) if match else -1

    sorted_snap_keys = sorted([key for key in snap_keys if key.startswith('snap_')], key=get_snap_number)
    
    if not sorted_snap_keys:
        print("No snapshot data found in the HDF5 file.")
        exit()

    print(f"--- Reading {len(sorted_snap_keys)} data using multiprocessing ---")

    args_list = [(hdf5_filepath, key, NS_KW_TYPE, MASS_CONVERSION_FACTOR) for key in sorted_snap_keys]

    num_processes = max(1, os.cpu_count() - 2)
    print(f"Using {num_processes} processes...")

    with Pool(processes=num_processes) as pool:
        results_list = list(tqdm(pool.imap(process_snapshot, args_list), total=len(sorted_snap_keys)))

    all_ns_records = [record for sublist in results_list if sublist for record in sublist]
    print(f"Total NS records found: {len(all_ns_records)}")

    if all_ns_records:
        df = pd.DataFrame(all_ns_records)
        df.to_csv(output_csv_filename, index=False)
        print(f"Successfully saved data to {output_csv_filename}")
    else:
        print("No neutron star records found to save.")