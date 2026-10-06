// Icons draw nothing in tests. Every icon set is the same stand-in component.
const React = require('react');
const {Text} = require('react-native');

const Icon = props => React.createElement(Text, null, props.name || '');
const proxy = new Proxy(
  {__esModule: true, default: Icon},
  {get: (target, key) => (key in target ? target[key] : Icon)},
);

module.exports = proxy;
