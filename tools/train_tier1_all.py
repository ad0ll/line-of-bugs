"""Fan out per-label training across TIER1_LABELS in parallel processes.

Each label fits its own HistGradientBoostingClassifier on independent data.
Using ProcessPool (not ThreadPool) because HGB's internal OpenMP and the
GIL on the surrounding Python overhead conspire to serialize ThreadPool
runs (measured: 4 labels via ThreadPool = ~180s vs ~17s/label solo).
ProcessPool gives each label its own Python interpreter + OMP pool.

OMP thread budget: each subprocess caps OMP at cores/workers so 4
workers × 4 OMP threads = 16 logical cores, no oversubscription.

Caching note: data load itself is ~5ms (parquet 2.8ms + labels.json 0.5ms
+ feature extract 0.2ms), so caching that is not worth it. BUT the
downstream predict step has a real caching win: predict_labels_batched
amortizes parquet I/O across labels (4× 1.8s sequential → 1.9s batched,
~4x speedup). Use predict_labels_batched, not per-label predicts, when
updating multiple labels after a training round.
The real CV cost (25 HGB fits × ~0.7s = ~17s) cannot be cached because
each fold uses a different train split.
"""
from __future__ import annotations
import os
import time
from concurrent.futures import ProcessPoolExecutor, as_completed

from scripts.detect_subjects.ml_labeler import TIER1_LABELS


def _train_one(label: str, omp_threads: int) -> dict:
    """Subprocess entry point. Caps OMP threads before sklearn import does
    its thread-pool init."""
    os.environ["OMP_NUM_THREADS"] = str(omp_threads)
    os.environ["MKL_NUM_THREADS"] = str(omp_threads)
    os.environ["OPENBLAS_NUM_THREADS"] = str(omp_threads)
    from scripts.detect_subjects.ml_labeler.train import train_label
    return train_label(label)


def main(max_workers: int = 4) -> None:
    n_cores = os.cpu_count() or 16
    per_worker = max(1, n_cores // max_workers)
    print(f"[train_all] {n_cores} cores, {max_workers} workers, "
          f"{per_worker} OMP threads/worker")

    t0 = time.perf_counter()
    results: dict[str, dict | str] = {}
    with ProcessPoolExecutor(max_workers=max_workers) as ex:
        futs = {ex.submit(_train_one, lbl, per_worker): lbl for lbl in TIER1_LABELS}
        for fut in as_completed(futs):
            lbl = futs[fut]
            try:
                results[lbl] = fut.result()
            except Exception as e:
                results[lbl] = f"FAILED: {type(e).__name__}: {e}"
    elapsed = time.perf_counter() - t0
    print(f"\n[train_all] {len(TIER1_LABELS)} labels in {elapsed:.1f}s "
          f"(workers={max_workers})")
    for lbl in TIER1_LABELS:
        r = results.get(lbl, "?")
        if isinstance(r, dict):
            arm = r["arm_scalar"]
            print(f"  {lbl}: n={r['n_total']} pos={r['n_positives']} "
                  f"MCC={arm['mcc_mean']:.3f}±{arm['mcc_std']:.3f} "
                  f"PR-AUC={arm['pr_auc_mean']:.3f}")
        else:
            print(f"  {lbl}: {r}")


if __name__ == "__main__":
    main()
