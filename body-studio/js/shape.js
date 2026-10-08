// Body Studio — procedural shape corrections on top of MakeHuman's morph
// targets (natural breast shape and support, and other body refinements).
// core.js calls BS.shapeCorrect(D, p, P) inside BS.morph after the targets are
// applied and before heightScale; P is the base-mesh position array (D.base units).
(function () {
  'use strict';
  const BS = (window.BS = window.BS || {});
  // filled in by the body-shape work; a no-op until then
  BS.shapeCorrect = BS.shapeCorrect || null;
})();
