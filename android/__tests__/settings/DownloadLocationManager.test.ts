jest.mock('../../src/settings/downloadLocationStore');

import * as downloadLocationStore from '../../src/settings/downloadLocationStore';
import { DownloadLocationManager } from '../../src/settings/DownloadLocationManager';
import { DownloadLocation } from '../../src/settings/types';

const customLocation: DownloadLocation = {
  mode: 'custom',
  treeUri: 'content://com.android.externalstorage.documents/tree/primary%3APhotos',
  displayName: 'Photos',
};

beforeEach(() => {
  jest.clearAllMocks();
});

test('restore() loads the persisted location into memory', async () => {
  (downloadLocationStore.readDownloadLocation as jest.Mock).mockResolvedValue(customLocation);

  const result = await DownloadLocationManager.restore();

  expect(result).toEqual(customLocation);
  expect(DownloadLocationManager.getLocation()).toEqual(customLocation);
  expect(DownloadLocationManager.isRestored()).toBe(true);
});

test('restore() with nothing persisted resolves to the default location', async () => {
  (downloadLocationStore.readDownloadLocation as jest.Mock).mockResolvedValue({ mode: 'default' });

  await DownloadLocationManager.restore();

  expect(DownloadLocationManager.getLocation()).toEqual({ mode: 'default' });
});

test('setLocation persists it and activates it immediately', async () => {
  await DownloadLocationManager.setLocation(customLocation);

  expect(downloadLocationStore.writeDownloadLocation).toHaveBeenCalledWith(customLocation);
  expect(DownloadLocationManager.getLocation()).toEqual(customLocation);
});

test('resetToDefault persists and activates the default location', async () => {
  await DownloadLocationManager.setLocation(customLocation);

  await DownloadLocationManager.resetToDefault();

  expect(downloadLocationStore.writeDownloadLocation).toHaveBeenLastCalledWith({ mode: 'default' });
  expect(DownloadLocationManager.getLocation()).toEqual({ mode: 'default' });
});

test('subscribe() notifies listeners on restore, setLocation, and resetToDefault, not after unsubscribing', async () => {
  (downloadLocationStore.readDownloadLocation as jest.Mock).mockResolvedValue({ mode: 'default' });
  const listener = jest.fn();
  const unsubscribe = DownloadLocationManager.subscribe(listener);

  await DownloadLocationManager.restore();
  expect(listener).toHaveBeenCalledTimes(1);

  await DownloadLocationManager.setLocation(customLocation);
  expect(listener).toHaveBeenCalledTimes(2);

  await DownloadLocationManager.resetToDefault();
  expect(listener).toHaveBeenCalledTimes(3);

  unsubscribe();
  await DownloadLocationManager.setLocation(customLocation);
  expect(listener).toHaveBeenCalledTimes(3);
});
