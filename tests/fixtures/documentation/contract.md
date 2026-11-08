# Prepared checkout contract

This is synthetic fixture authority, not an application execution result.
When guest checkout is disabled and no user is supplied, checkout shall return
status 401 with requires_login set to true.

Prepared change request: a future checkout adapter should expose a stable
authentication-required error code. This is a proposal, not an accepted or
implemented API contract. No performance target has been agreed.
