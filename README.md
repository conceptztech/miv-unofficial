# Miv Unofficial

An Expo React Native WebView wrapper for Miva Open University LMS.

## Features

- LMS WebView pointed at `https://lms.miva.university/my/courses.php`
- Right drawer with Home, Calendar, Grades, Support, Settings, and Misc
- Targeted Zoho/SalesIQ live-chat removal
- Persisted video speed and quality preference controls
- Keep-awake toggle for lecture sessions
- Android hardware-back support, pull-to-refresh, browser fallback, and request-driven load progress
- Android automatic picture-in-picture when a Vimeo or HTML video is playing
- PDFs and file downloads open in the installed browser; no in-app PDF renderer
- Secure Login below Misc: biometric unlock, encrypted credential storage, fill, edit, and delete
- Daily learning reminders and optional last-page restoration

## Run

```bash
npm install
npm run start
```

Use a development build. Expo Go cannot run the local Android PiP/download module or test Face ID protection correctly.

## Native Release 1.1.0

Install a new EAS build for this release. It adds `expo-secure-store`, `expo-local-authentication`, `expo-web-browser`, and the local Android module in `modules/miv-device`. OTA compatibility uses Expo's fingerprint policy so native changes produce a new runtime without relying on a manual display-version bump. Existing app-version-based builds will not receive fingerprint-based updates; install the new binary first. Publish subsequent compatible updates to the channel used by that build.

Android PiP uses auto-enter on Android 12+ and the activity leave callback on Android 8-11. It activates only while a video is playing and depends on the device allowing PiP for the app. iOS uses WebKit's supported video/PiP behavior; automatic inline Vimeo PiP on iOS is not guaranteed by this Android module.

PDF links open through the system browser. Embedded PDFs have an Open PDF in browser action. The Android native download handler also catches PDFs without a file extension. Browser sessions are separate from WebView sessions, and the browser may require LMS sign-in. The browser and server ultimately determine whether the document is displayed or downloaded.

Secure Login requires enrolled biometrics. Tap Secure Login to unlock and fill saved credentials; use its adjacent settings icon to manage them. New credentials are entered manually and stored using authenticated SecureStore, never AsyncStorage. Filling is restricted to the HTTPS LMS login form and the SIS `/cas/login` page, including its React-controlled email and password inputs. It never submits automatically. Unlocked details are cleared on background or close; biometric enrollment changes may invalidate saved credentials.

The load bar starts on link taps, submissions, or native navigation commands, follows WebView's reported progress, and disappears after load completion or error. It is a page-load estimate rather than a percentage of downloaded bytes.

## Verification

```bash
npm run typecheck
npm test
node tests/verify-native.cjs
```

The native verification script generates Android files in an isolated temporary directory and checks the PiP lifecycle hooks and biometric permission. It does not compile Kotlin or replace the project's native files.

Device checks after installing the build: play and pause Vimeo before pressing Home, restore from PiP, open a protected PDF link and embed, cancel biometrics, fill and edit credentials, background the editor, and navigate on a slow connection. Native biometric/PiP behavior cannot be proven by JavaScript tests.

## EAS Builds

Use the project scripts so EAS runs through the latest CLI:

```bash
npm run build:android:development
npm run build:android:preview
npm run build:android:production
```

## Credits

Developed by [Creative Conceptz Solutions](https://conceptz.com.ng). First released June, 2026.

## Note

This is an unofficial companion app. Miva reserves all rights.
