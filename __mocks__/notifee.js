// Notifications are native. Every call succeeds and does nothing.
const asyncNoop = async () => undefined;
const notifee = new Proxy(
  {
    onForegroundEvent: () => () => undefined,
    onBackgroundEvent: () => undefined,
    getInitialNotification: async () => null,
    getNotificationSettings: async () => ({authorizationStatus: 1}),
    requestPermission: async () => ({authorizationStatus: 1}),
    createChannel: async id => id,
  },
  {get: (target, key) => (key in target ? target[key] : asyncNoop)},
);
const enumLike = new Proxy({}, {get: (_target, key) => String(key)});

module.exports = {
  __esModule: true,
  default: notifee,
  AndroidImportance: enumLike,
  AndroidVisibility: enumLike,
  AndroidForegroundServiceType: enumLike,
  AndroidGroupAlertBehavior: enumLike,
  AndroidLaunchActivityFlag: enumLike,
  AuthorizationStatus: {AUTHORIZED: 1, PROVISIONAL: 2, DENIED: 0},
  EventType: enumLike,
  TriggerType: {TIMESTAMP: 0, INTERVAL: 1},
};
