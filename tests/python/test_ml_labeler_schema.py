"""Schema v3: predicted_<label>_p column exists in DetectionRow."""
from scripts.detect_subjects.schema import SCHEMA, DetectionRow


def test_predicted_column_in_schema():
    field_names = {f.name for f in SCHEMA}
    assert "predicted_mask_blur_unusable_p" in field_names
    assert "predicted_mask_blur_unusable_unreliable" in field_names


def test_schema_version_3():
    from scripts.detect_subjects.config import SCHEMA_VERSION
    assert SCHEMA_VERSION == 3
