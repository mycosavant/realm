/**
 * Pure game logic. Nothing in this directory may import `three`, `react`, or
 * touch the DOM — see CLAUDE.md. Rendering, UI and persistence depend on this
 * module, never the reverse.
 */
export * from './rng';
export * from './availability';
export * from './specimen';
export * from './examination';
export * from './scoring';
export * from './progression';
