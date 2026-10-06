// Packages that only make sense on a device. Any named export or default is a
// component that draws nothing, or a function that does nothing.
const React = require('react');

const Stub = () => null;
const fn = () => undefined;
const enumLike = new Proxy({}, {get: (_target, key) => String(key)});

const exported = new Proxy(
  {__esModule: true},
  {
    get: (target, key) => {
      if (key in target) {
        return target[key];
      }
      if (key === 'default') {
        return exported;
      }
      // Names like "SelectedTrackType" or "TextTrackType" are used as enums.
      if (/(Type|Types|Mode|Status|Orientation|Strategy|Event)$/.test(String(key))) {
        return enumLike;
      }
      return /^[A-Z]/.test(String(key)) ? Stub : fn;
    },
  },
);

module.exports = exported;
