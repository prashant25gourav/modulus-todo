/* global jest */
// Mock react-native-safe-area-context using its official mock
const mockSafeArea = require('react-native-safe-area-context/jest/mock').default;
jest.mock('react-native-safe-area-context', () => mockSafeArea);

// Mock react-native-keychain
jest.mock('react-native-keychain', () => ({
  setGenericPassword: jest.fn().mockResolvedValue(true),
  getGenericPassword: jest.fn().mockResolvedValue(false),
  resetGenericPassword: jest.fn().mockResolvedValue(true),
}));

// Mock datetimepicker
jest.mock('@react-native-community/datetimepicker', () => {
  const React = require('react');
  const View = require('react-native').View;
  return (props) => React.createElement(View, props);
});
