const path = require('node:path');
const React = require('react');
const { createLoader } = require('./load-typescript.cjs');

exports.loadScrollAwayHeader = function () {
  const animations = [];
  const native = {
    View: 'View', StyleSheet: { create: (v) => v },
    Animated: {
      View: 'AnimatedView',
      Value: class { constructor(value) { this.value = value; } setValue(value) { this.value = value; } },
      timing(value, config) {
        const entry = { value, config, stopped: false };
        animations.push(entry);
        return { start() { value.setValue(config.toValue); }, stop() { entry.stopped = true; } };
      },
    },
  };
  const load = createLoader({ react: React, 'react-native': native, '../theme/colors': { Colors: { dark: { background: '#000' } } } });
  return {
    hook: load(path.resolve(__dirname, '../../src/utils/scrollAwayHeader.ts')),
    component: load(path.resolve(__dirname, '../../src/components/ScrollAwayHeader.tsx')),
    animations,
  };
};
