import {
  clearAppLock,
  getLockoutSeconds,
  getLockTimeoutSeconds,
  getPinLength,
  isAppLockEnabled,
  isValidPin,
  setAppLockPin,
  setLockTimeoutSeconds,
  shouldLockAfterBackground,
  verifyAppLockPin,
} from '../src/lib/appLock';
import {mainStorage} from '../src/lib/storage/StorageService';

describe('PIN rules', () => {
  it('accepts 4 to 8 digits only', () => {
    expect(isValidPin('1234')).toBe(true);
    expect(isValidPin('12345678')).toBe(true);
    expect(isValidPin('123')).toBe(false);
    expect(isValidPin('123456789')).toBe(false);
    expect(isValidPin('12a4')).toBe(false);
    expect(isValidPin('')).toBe(false);
  });
});

describe('lockout', () => {
  it('allows five wrong tries, then makes the user wait longer each time', () => {
    const now = 1_000_000_000_000;
    const sec = now / 1000;
    expect(getLockoutSeconds(4, sec, now)).toBe(0);
    expect(getLockoutSeconds(5, sec, now)).toBe(30);
    expect(getLockoutSeconds(6, sec, now)).toBe(60);
    expect(getLockoutSeconds(7, sec, now)).toBe(120);
    expect(getLockoutSeconds(20, sec, now)).toBe(15 * 60);
  });

  it('counts the wait down as time passes', () => {
    const now = 1_000_000_000_000;
    expect(getLockoutSeconds(5, now / 1000 - 10, now)).toBe(20);
    expect(getLockoutSeconds(5, now / 1000 - 45, now)).toBe(0);
  });
});

describe('when to ask again', () => {
  it('asks after the app was away for the chosen time', () => {
    expect(shouldLockAfterBackground(0, 59_000, 60)).toBe(false);
    expect(shouldLockAfterBackground(0, 60_000, 60)).toBe(true);
    expect(shouldLockAfterBackground(0, 1, 0)).toBe(true);
  });
});

describe('the saved PIN', () => {
  beforeEach(() => clearAppLock());

  it('is off until a PIN is set, and never stores the PIN itself', async () => {
    expect(isAppLockEnabled()).toBe(false);
    await setAppLockPin('4821');
    expect(isAppLockEnabled()).toBe(true);
    expect(getPinLength()).toBe(4);
    expect(String(mainStorage.getString('appLockHash'))).not.toContain('4821');
    expect(mainStorage.getString('appLockSalt')).toBeTruthy();
  });

  it('opens with the right PIN and refuses a wrong one', async () => {
    await setAppLockPin('4821');
    await expect(verifyAppLockPin('4821')).resolves.toBe('ok');
    await expect(verifyAppLockPin('0000')).resolves.toBe('wrong');
  });

  it('makes the user wait after five wrong tries, even for the right PIN', async () => {
    await setAppLockPin('4821');
    const now = Date.now();
    for (let i = 0; i < 5; i += 1) {
      await expect(verifyAppLockPin('1111', now)).resolves.toBe('wrong');
    }
    await expect(verifyAppLockPin('4821', now + 1000)).resolves.toBe('wait');
    // After the wait the right PIN works and clears the count.
    await expect(verifyAppLockPin('4821', now + 31_000)).resolves.toBe('ok');
    await expect(verifyAppLockPin('1111', now + 32_000)).resolves.toBe('wrong');
    await expect(verifyAppLockPin('4821', now + 33_000)).resolves.toBe('ok');
  });

  it('rejects a PIN that is not valid, and removes the lock when cleared', async () => {
    await expect(setAppLockPin('12')).rejects.toThrow('4 to 8 digits');
    await setAppLockPin('123456');
    clearAppLock();
    expect(isAppLockEnabled()).toBe(false);
    await expect(verifyAppLockPin('anything')).resolves.toBe('ok');
  });

  it('keeps the chosen delay, with a default', () => {
    expect(getLockTimeoutSeconds()).toBe(60);
    setLockTimeoutSeconds(300);
    expect(getLockTimeoutSeconds()).toBe(300);
    setLockTimeoutSeconds(7);
    expect(getLockTimeoutSeconds()).toBe(60);
  });
});
