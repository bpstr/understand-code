# Registration through a factory

Question: Which handler actually implements checkout?

Expected: follow the registry/factory binding to `LiveHandler`; do not claim `DeadHandler` participates merely because it has a compatible shape.
