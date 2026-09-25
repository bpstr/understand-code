# Same paths and symbols across repositories

Question: What does `src/service.py:status` mean in each repository?

Expected: repository-qualified identities keep the two symbols and evidence scopes separate. Results from repo A must never leak into repo B merely because paths and symbol names match.
