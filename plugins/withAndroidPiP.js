const { AndroidConfig, withAndroidManifest, withMainActivity } = require('@expo/config-plugins');

const REQUIRED_CONFIG_CHANGES = [
  'keyboard',
  'keyboardHidden',
  'orientation',
  'screenLayout',
  'screenSize',
  'smallestScreenSize',
  'uiMode',
];

const mergeConfigChanges = (currentValue) => {
  const existing = String(currentValue || '')
    .split('|')
    .map((item) => item.trim())
    .filter(Boolean);
  return Array.from(new Set([...existing, ...REQUIRED_CONFIG_CHANGES])).join('|');
};

module.exports = function withAndroidPiP(config) {
  config = withAndroidManifest(config, (config) => {
    const mainActivity = AndroidConfig.Manifest.getMainActivityOrThrow(config.modResults);
    mainActivity.$['android:supportsPictureInPicture'] = 'true';
    mainActivity.$['android:resizeableActivity'] = 'true';
    mainActivity.$['android:configChanges'] = mergeConfigChanges(mainActivity.$['android:configChanges']);
    return config;
  });
  return withMainActivity(config, (config) => {
    if (config.modResults.language !== 'kt') throw new Error('Miv PiP requires a Kotlin MainActivity.');
    let contents = config.modResults.contents;
    const marker = '// Miv native video lifecycle';
    if (!contents.includes(marker)) {
      const end = contents.lastIndexOf('}');
      if (end < 0) throw new Error('MainActivity class was not found.');
      const methods = `
  ${marker}
  override fun onUserLeaveHint() {
    super.onUserLeaveHint()
    expo.modules.mivdevice.MivDeviceController.onUserLeaveHint(this)
  }

  override fun onPictureInPictureModeChanged(active: Boolean, config: android.content.res.Configuration) {
    super.onPictureInPictureModeChanged(active, config)
    expo.modules.mivdevice.MivDeviceController.onModeChanged(this, active)
  }

  override fun onStop() {
    super.onStop()
    expo.modules.mivdevice.MivDeviceController.onStop(this)
  }
`;
      contents = contents.slice(0, end) + methods + contents.slice(end);
    }
    config.modResults.contents = contents;
    return config;
  });
};
