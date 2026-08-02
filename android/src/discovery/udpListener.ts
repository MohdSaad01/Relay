/**
 * Thin wrapper around react-native-udp: binds a socket on `port` and reports
 * each datagram's raw UTF-8 payload. Deliberately has no idea what a
 * "discovery announcement" looks like — that parsing/policy lives in
 * DiscoveryService, so this file would be reusable for any other future
 * UDP need without change.
 *
 * No location permission is required to receive a broadcast on Android —
 * that permission only gates active Wi-Fi *scanning* APIs, not plain socket
 * receipt of datagrams already arriving on the network.
 */

import dgram from 'react-native-udp';

export interface UdpListenerHandle {
  stop: () => void;
}

export function startUdpListener(
  port: number,
  onMessage: (data: string, remoteAddress: string) => void,
  onError?: (error: Error) => void,
): UdpListenerHandle {
  const socket = dgram.createSocket({ type: 'udp4' });

  socket.on('message', (msg: Buffer, rinfo: { address: string }) => {
    onMessage(msg.toString('utf8'), rinfo.address);
  });

  socket.on('error', (err: Error) => {
    onError?.(err);
  });

  socket.bind(port, () => {
    // Some Android network stacks require SO_BROADCAST set explicitly even
    // just to receive broadcast datagrams, not only to send them.
    socket.setBroadcast(true);
  });

  return {
    stop: () => socket.close(),
  };
}
