// Manual Jest mock for the notification module (same reasoning as the other
// __mocks__ entries). Values of AndroidImportance/EventType are arbitrary --
// only referential consistency with what downloadNotification.ts itself
// imports from this same mock matters, not the real notifee enum values.
const AndroidImportance = { DEFAULT: 3 };
const EventType = { PRESS: 1 };

module.exports = {
  createChannel: jest.fn(() => Promise.resolve('relay-downloads')),
  displayNotification: jest.fn(() => Promise.resolve('notification-id')),
  onForegroundEvent: jest.fn(() => () => undefined),
  onBackgroundEvent: jest.fn(),
  AndroidImportance,
  EventType,
};
