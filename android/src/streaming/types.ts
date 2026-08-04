import { TransferDirection } from '../api/types';

export type StreamStatus = 'streaming' | 'completed' | 'failed' | 'cancelled';

/** Live, client-side view of the one transfer TransferStreamManager is (or just was) actively moving bytes for. */
export interface StreamState {
  transferId: number;
  direction: TransferDirection;
  fileName: string;
  bytesTransferred: number;
  totalBytes: number;
  status: StreamStatus;
  error: string | null;
}

/** A file picked locally for an upload (direction "receive"), remembered from the moment it's proposed (auto-accepted) until its stream starts. */
export interface PickedUploadFile {
  uri: string;
  name: string;
  size: number;
}
