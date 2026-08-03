# Infinite canvas connection rendering

Canvas connections are rendered inside one fixed `10000px` by `10000px` SVG in the transformed canvas coordinate layer.

The scoped media reset in `src/infiniteCanvas/canvas.css` must not apply `max-width` to SVG elements. The transformed parent intentionally has no layout width, so `max-width: 100%` collapses the connection SVG to zero width and hides both:

- saved node connections;
- the active dashed connection shown while dragging.

Image and video media remain constrained by the scoped reset. Connection behavior, canvas persistence, IndexedDB data, node records, and connection records are not changed by this styling rule.
