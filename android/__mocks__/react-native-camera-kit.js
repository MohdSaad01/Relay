// Manual Jest mock for the native camera module (same reasoning as
// __mocks__/react-native-keychain.js and __mocks__/react-native-udp.js).
// Its real entry point pulls in a Fabric/Codegen native component spec that
// Jest's Babel pipeline can't transform outside a real RN build — and
// there's nothing a Jest test could meaningfully assert about real camera
// preview behavior anyway.
const React = require('react');
const { View } = require('react-native');

function Camera(props) {
  return React.createElement(View, { testID: 'mock-camera', ...props });
}

module.exports = {
  Camera,
  CameraType: { Front: 'front', Back: 'back' },
};
