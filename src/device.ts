import { requireOptionalNativeModule, NativeModule } from 'expo';

type DeviceEvents = {
  pipChanged: (event: { active: boolean }) => void;
  download: (event: { url: string }) => void;
};

declare class DeviceModule extends NativeModule<DeviceEvents> {
  attach(): Promise<void>;
  setVideoPlaying(playing: boolean): Promise<void>;
  setBlocked(blocked: boolean): Promise<void>;
};

const nativeDevice = requireOptionalNativeModule<DeviceModule>('MivDevice');

export const device = nativeDevice && {
  addListener<Event extends keyof DeviceEvents>(name: Event, listener: DeviceEvents[Event]) {
    return nativeDevice.addListener(name, listener);
  },
  attach: () => nativeDevice.attach().catch(() => {}),
  setVideoPlaying: (playing: boolean) => nativeDevice.setVideoPlaying(playing).catch(() => {}),
  setBlocked: (blocked: boolean) => nativeDevice.setBlocked(blocked).catch(() => {}),
};
