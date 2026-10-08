// Body Studio — swimwear: bikinis and swimsuits, built on clothing.js's garment
// kit. Registers BS.OUTFIT_BUILDERS[id](kit) -> garment list and optionally
// BS.OUTFIT_EXTRAS[id](ctx, clothing, p) -> Object3D[] for ties and bows.
(function () {
  'use strict';
  const BS = (window.BS = window.BS || {});
  BS.OUTFIT_BUILDERS = BS.OUTFIT_BUILDERS || {};
  BS.OUTFIT_EXTRAS = BS.OUTFIT_EXTRAS || {};
})();
