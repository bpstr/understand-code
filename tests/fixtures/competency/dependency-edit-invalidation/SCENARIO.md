# Dependency edit invalidates only necessary claims

Procedure: reconstruct checkout total, then change `config.py:TAX_RATE`.

Expected: invalidate/review claims depending on TAX_RATE and checkout total. Do not invalidate unrelated support configuration or unrelated connected concepts.
