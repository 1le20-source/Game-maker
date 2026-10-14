// Feature modules. Each file exports default { id, init(app) }.
// Add a module by adding one line here; nothing else in the core changes.
// They load in this order; a module that throws is skipped and logged.

export const modules = [
  () => import('./motion.js'),
  () => import('./world.js'),
  () => import('./wardrobe.js'),
  () => import('./games.js'),
  () => import('./story.js'),
];
