import * as Crypto from 'expo-crypto';
import {mainStorage} from './storage/StorageService';

/**
 * A PIN that must be entered to open the app. Only a salted hash of the PIN
 * is kept, never the PIN. This stops someone who picks up an unlocked phone;
 * it is not protection against someone with full access to the device.
 */

const HASH_KEY = 'appLockHash';
const SALT_KEY = 'appLockSalt';
const LENGTH_KEY = 'appLockLength';
const TIMEOUT_KEY = 'appLockTimeoutSeconds';
const FAILS_KEY = 'appLockFails';
const LAST_FAIL_KEY = 'appLockLastFailAt';

export const PIN_MIN_LENGTH = 4;
export const PIN_MAX_LENGTH = 8;
export const DEFAULT_LOCK_TIMEOUT_SECONDS = 60;
export const LOCK_TIMEOUT_OPTIONS: Array<{seconds: number; label: string}> = [
  {seconds: 0, label: 'Right away'},
  {seconds: 60, label: 'After 1 minute'},
  {seconds: 300, label: 'After 5 minutes'},
  {seconds: 900, label: 'After 15 minutes'},
];

/** Wrong tries allowed before the app makes the user wait. */
const FREE_ATTEMPTS = 5;
const BASE_LOCKOUT_SECONDS = 30;
const MAX_LOCKOUT_SECONDS = 15 * 60;

export const isValidPin = (pin: string): boolean =>
  new RegExp(`^\\d{${PIN_MIN_LENGTH},${PIN_MAX_LENGTH}}$`).test(pin);

export const isAppLockEnabled = (): boolean => Boolean(mainStorage.getString(HASH_KEY));

export const getPinLength = (): number => mainStorage.getNumber(LENGTH_KEY) || PIN_MIN_LENGTH;

const hashPin = (salt: string, pin: string): Promise<string> =>
  Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, `${salt}:${pin}`);

export const setAppLockPin = async (pin: string): Promise<void> => {
  if (!isValidPin(pin)) {
    throw new Error(`The PIN must be ${PIN_MIN_LENGTH} to ${PIN_MAX_LENGTH} digits`);
  }
  const salt = Crypto.randomUUID();
  mainStorage.setString(SALT_KEY, salt);
  mainStorage.setString(HASH_KEY, await hashPin(salt, pin));
  mainStorage.setNumber(LENGTH_KEY, pin.length);
  mainStorage.setNumber(FAILS_KEY, 0);
};

export const clearAppLock = (): void => {
  [HASH_KEY, SALT_KEY, LENGTH_KEY, FAILS_KEY, LAST_FAIL_KEY].forEach(key => mainStorage.delete(key));
};

/** Seconds the user must still wait after too many wrong tries; 0 when free to try. */
export const getLockoutSeconds = (fails: number, lastFailAtSeconds: number, nowMs: number): number => {
  if (fails < FREE_ATTEMPTS) {
    return 0;
  }
  const wait = Math.min(
    BASE_LOCKOUT_SECONDS * 2 ** (fails - FREE_ATTEMPTS),
    MAX_LOCKOUT_SECONDS,
  );
  return Math.max(Math.ceil(wait - (nowMs / 1000 - lastFailAtSeconds)), 0);
};

export const getCurrentLockoutSeconds = (nowMs: number = Date.now()): number =>
  getLockoutSeconds(
    mainStorage.getNumber(FAILS_KEY) || 0,
    mainStorage.getNumber(LAST_FAIL_KEY) || 0,
    nowMs,
  );

export type PinResult = 'ok' | 'wrong' | 'wait';

export const verifyAppLockPin = async (pin: string, nowMs: number = Date.now()): Promise<PinResult> => {
  if (getCurrentLockoutSeconds(nowMs) > 0) {
    return 'wait';
  }
  const hash = mainStorage.getString(HASH_KEY);
  const salt = mainStorage.getString(SALT_KEY);
  if (!hash || !salt) {
    return 'ok';
  }
  if ((await hashPin(salt, pin)) === hash) {
    mainStorage.setNumber(FAILS_KEY, 0);
    return 'ok';
  }
  mainStorage.setNumber(FAILS_KEY, (mainStorage.getNumber(FAILS_KEY) || 0) + 1);
  mainStorage.setNumber(LAST_FAIL_KEY, Math.floor(nowMs / 1000));
  return 'wrong';
};

export const getLockTimeoutSeconds = (): number => {
  const value = mainStorage.getNumber(TIMEOUT_KEY);
  return LOCK_TIMEOUT_OPTIONS.some(option => option.seconds === value)
    ? (value as number)
    : DEFAULT_LOCK_TIMEOUT_SECONDS;
};

export const setLockTimeoutSeconds = (seconds: number): void => {
  mainStorage.setNumber(
    TIMEOUT_KEY,
    LOCK_TIMEOUT_OPTIONS.some(option => option.seconds === seconds)
      ? seconds
      : DEFAULT_LOCK_TIMEOUT_SECONDS,
  );
};

/** Whether the app was away long enough that it should ask for the PIN again. */
export const shouldLockAfterBackground = (
  backgroundedAtMs: number,
  nowMs: number,
  timeoutSeconds: number,
): boolean => nowMs - backgroundedAtMs >= timeoutSeconds * 1000;
