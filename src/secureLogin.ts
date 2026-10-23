import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';

export type LoginDetails = { username: string; password: string };
const KEY = 'miv.secure-login.v1';
type IsActive = () => boolean;
const assertActive = (isActive: IsActive) => {
  if (!isActive()) throw new Error('Secure Login was closed. Unlock it again to continue.');
};
const options: SecureStore.SecureStoreOptions = {
  requireAuthentication: true,
  authenticationPrompt: 'Unlock your Miva login',
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

export async function verifyBiometrics(isActive: IsActive = () => true) {
  assertActive(isActive);
  if (!SecureStore.canUseBiometricAuthentication()) {
    throw new Error('Set up fingerprint or Face ID in your device settings to use Secure Login. Android requires a strong biometric.');
  }
  const result = await LocalAuthentication.authenticateAsync({
    promptMessage: 'Unlock your Miva login',
    disableDeviceFallback: true,
    biometricsSecurityLevel: 'strong',
    cancelLabel: 'Cancel',
  });
  if (!result.success) throw new Error('Biometric verification was cancelled or unsuccessful.');
  assertActive(isActive);
}

export async function unlockLogin(isActive: IsActive = () => true): Promise<LoginDetails | null> {
  assertActive(isActive);
  if (!SecureStore.canUseBiometricAuthentication()) {
    throw new Error('Set up fingerprint or Face ID in your device settings to use Secure Login.');
  }
  const value = await SecureStore.getItemAsync(KEY, options);
  assertActive(isActive);
  if (!value) {
    await verifyBiometrics(isActive);
    return null;
  }
  const parsed = JSON.parse(value) as LoginDetails;
  if (!parsed || typeof parsed.username !== 'string' || typeof parsed.password !== 'string') throw new Error('Saved login is invalid.');
  return parsed;
}

export async function saveLogin(details: LoginDetails, isActive: IsActive = () => true) {
  if (!details.username.trim() || !details.password) throw new Error('Enter your LMS username and password.');
  // Require a fresh biometric check for both initial creation and replacement.
  await verifyBiometrics(isActive);
  await SecureStore.setItemAsync(KEY, JSON.stringify({ ...details, username: details.username.trim() }), options);
  assertActive(isActive);
}

export async function removeLogin(isActive: IsActive = () => true) {
  await verifyBiometrics(isActive);
  await SecureStore.deleteItemAsync(KEY, options);
  assertActive(isActive);
}

export const buildLoginFillScript = (details: LoginDetails) => `
(function () {
  var ok = false;
  if (location.origin === 'https://lms.miva.university' && /^\\/login\\//.test(location.pathname)) {
    var password = document.querySelector('input[type="password"]');
    var form = password && password.closest('form');
    var username = form && form.querySelector('input[name="username"], input[autocomplete="username"], input[type="email"]');
    if (form && username && form.method.toLowerCase() === 'post' && new URL(form.action || location.href, location.href).origin === location.origin) {
      var details = ${JSON.stringify(details).replace(/</g, '\\u003c')};
      var setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      [[username, details.username], [password, details.password]].forEach(function (pair) {
        setter.call(pair[0], pair[1]);
        pair[0].dispatchEvent(new Event('input', { bubbles: true }));
        pair[0].dispatchEvent(new Event('change', { bubbles: true }));
      });
      password.focus();
      details = null;
      ok = true;
    }
  }
  window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'login-filled', ok: ok }));
})();
true;
`;
