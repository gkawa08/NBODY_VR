import h5py
import re
import numpy as np
import pandas as pd
from tqdm import tqdm
from multiprocessing import Pool
import os

def process_snapshot(args):
    hdf5_filepath, key, BH_KW_TYPE, MASS_CONVERSION_FACTOR = args
    bh_records = []

    with h5py.File(hdf5_filepath, 'r') as f_h5:
        data = f_h5[key]

        if not data:
            return bh_records

        time = data['t'][()]
        kw_types = data['kw'][()]
        bh_mask = (kw_types == BH_KW_TYPE)
        num_bhs = np.sum(bh_mask)

        if num_bhs > 0:
            ids = data['id'][()]
            masses = data['m'][()]
            vxs = data['vx'][()]
            vys = data['vy'][()]
            vzs = data['vz'][()]
            xs = data['x'][()]
            ys = data['y'][()]
            zs = data['z'][()]

            bh_ids = ids[bh_mask]
            bh_masses = masses[bh_mask] * MASS_CONVERSION_FACTOR
            bh_vxs = vxs[bh_mask]
            bh_vys = vys[bh_mask]
            bh_vzs = vzs[bh_mask]
            bh_xs = xs[bh_mask]
            bh_ys = ys[bh_mask]
            bh_zs = zs[bh_mask]

            for i in range(num_bhs):
                record = {
                    'time_myr': time,
                    'bh_id': bh_ids[i],
                    'mass_msun': bh_masses[i],
                    'vx': bh_vxs[i],
                    'vy': bh_vys[i],
                    'vz': bh_vzs[i],
                    'x': bh_xs[i],
                    'y': bh_ys[i],
                    'z': bh_zs[i],
                }
                bh_records.append(record)
                
            return bh_records



if __name__ == "__main__":
    
    hdf5_filepath = '/Volumes/Kingcess/NBODY6/snapdata.hdf5'

    BH_KW_TYPE = 14

    MASS_CONVERSION_FACTOR = 127918.2

    output_csv_filename = 'bh_history.csv'

    with h5py.File(hdf5_filepath, 'r') as f_h5:
        snap_keys = list(f_h5.keys())

    def get_snap_number(key):
        match = re.match(r'snap_(\d+)', key)
        return int(match.group(1)) if match else -1

    sorted_snap_keys = sorted([key for key in snap_keys if key.startswith('snap_')], key=get_snap_number)
    keys_to_process = sorted_snap_keys

    print(f"--- Reading {len(keys_to_process)} data using multiprocessing ---")

    args_list = [(hdf5_filepath, key, BH_KW_TYPE, MASS_CONVERSION_FACTOR) for key in keys_to_process]

    num_processes = os.cpu_count() -2

    print(f"Using {num_processes} processes...")

    with Pool(processes=num_processes) as pool:
        results_list = list(tqdm(pool.imap(process_snapshot, args_list), total=len(keys_to_process)))

    all_bh_records = [record for sublist in results_list for record in sublist]
    print(f"Total BH records found: {len(all_bh_records)}")

    if all_bh_records:

        df = pd.DataFrame(all_bh_records)
        df.to_csv(output_csv_filename, index=False)

        print(f"Successfully saved data to {output_csv_filename}")

    else:
        print("No black hole records found to save.")