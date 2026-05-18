"""Verify scalar feature extraction from a polars row dict."""
import numpy as np


def test_scalar_features_from_row_dict():
    from scripts.detect_subjects.ml_labeler.features import (
        SCALAR_FEATURE_NAMES, scalar_feature_vector,
    )
    # 12 named features per spec §architecture
    assert len(SCALAR_FEATURE_NAMES) == 12
    row = {name: float(i) for i, name in enumerate(SCALAR_FEATURE_NAMES)}
    vec = scalar_feature_vector(row)
    assert vec.shape == (12,)
    assert vec.dtype == np.float32
    np.testing.assert_array_equal(vec, np.arange(12, dtype=np.float32))


def test_scalar_features_handles_none_as_nan():
    from scripts.detect_subjects.ml_labeler.features import scalar_feature_vector, SCALAR_FEATURE_NAMES
    row = {name: None for name in SCALAR_FEATURE_NAMES}
    vec = scalar_feature_vector(row)
    assert vec.shape == (12,)
    assert np.isnan(vec).all()
