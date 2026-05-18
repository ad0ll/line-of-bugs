"""Verify ml_labeler package imports and exposes expected surface."""


def test_package_imports():
    from scripts.detect_subjects.ml_labeler import TIER1_LABELS, MODELS_DIR

    assert "mask_blur_unusable" in TIER1_LABELS
    assert MODELS_DIR.name == "models"
    assert MODELS_DIR.exists()
