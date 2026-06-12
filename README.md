# Miv Unofficial

An Expo React Native WebView wrapper for Miva Open University LMS.

## Features

- LMS WebView pointed at `https://lms.miva.university/my/courses.php`
- Native shortcuts for courses, dashboard, calendar, grades, and messages
- Injected cleanup layer for common live-chat widgets
- Persisted video speed and quality preference controls
- Keep-awake toggle for lecture sessions
- Android hardware-back support, reload, browser fallback, and load progress

## Run

```bash
npm install
npm run start
```

Then open the project with Expo Go or a development build.

## EAS Builds

Use the project scripts so EAS runs through the latest CLI:

```bash
npm run build:android:development
npm run build:android:preview
npm run build:android:production
```

## Credits

Developed by [Creative Conceptz Solutions](https://conceptz.com.ng).
First developed in June 2026.

## Note

This is an unofficial companion app. Public store distribution should use authorized Miva branding/assets and review Miva's terms before release.
