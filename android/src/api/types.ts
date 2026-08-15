/**
 * TypeScript mirrors of the backend's Pydantic schemas (backend/app/schemas/).
 *
 * Only the schemas Android is sanctioned to use are modeled here — the
 * endpoints documented as Android/dual-audience in backend/README.md
 * (`/pairing/request`, `/pairing/result/{token}`, `GET /files`,
 * `/transfers*` excluding the desktop-only accept/reject decision,
 * `PATCH /devices/{id}` for renaming itself only — P23). Fields
 * stay snake_case, matching the JSON exactly as the backend serializes it —
 * no case-conversion layer, per the thin-client rule (no logic beyond what
 * the API boundary itself requires).
 *
 * Every date field is the raw ISO 8601 string Pydantic serializes, not a
 * parsed Date — parsing/formatting is a screen concern, not an API-layer one.
 */

/** Standard envelope every backend response uses (app/schemas/common.py). */
export interface ApiResponse<T> {
  success: boolean;
  message: string;
  data: T;
}

/** Generic shape for the backend's ad hoc `{"status": "..."}` acknowledgements. */
export interface StatusResponse {
  status: string;
}

// --- Pairing (app/schemas/pairing.py) ---------------------------------------

export type Platform = 'android';

/** The JSON payload encoded in the desktop's pairing QR code. */
export interface PairingQrPayload {
  desktop_ip: string;
  port: number;
  pairing_token: string;
  protocol_version: number;
  relay_version: string;
}

/** Payload for POST /pairing/request, submitted by a scanning Android device. */
export interface PairingRequestSubmitRequest {
  pairing_token: string;
  device_identifier: string;
  device_name: string;
  platform: Platform;
}

/**
 * Response for GET /pairing/result/{token}: one-time pairing credentials.
 * device_name is the backend's authoritative final name (P43.1) - it may
 * differ from what this device submitted in PairingRequestSubmitRequest if
 * the desktop user resolved a name collision with "Make it a new device"
 * (e.g. "Thomas" -> "Thomas (1)"). Always use this value, never the
 * originally-submitted name, when establishing the session.
 */
export interface PairingResultResponse {
  device_id: number;
  device_identifier: string;
  device_name: string;
  device_secret: string;
  session_token: string;
  session_expires_at: string;
}

// --- Devices (app/schemas/device.py) ----------------------------------------

/** Payload for PATCH /devices/{id} — device_name is the only mutable field. */
export interface DeviceUpdateRequest {
  device_name: string;
}

/** The fields Android reads back from a successful device rename (P23). */
export interface DeviceRenameResponse {
  id: number;
  device_name: string;
}

// --- Shared files (app/schemas/shared_file.py) ------------------------------

/** Sanitized view of a shared file returned to a paired Android device (no file_path). */
export interface AvailableFileResponse {
  id: number;
  file_name: string;
  file_size: number;
  mime_type: string | null;
  shared_at: string;
}

// --- Shared folders (app/schemas/shared_folder.py, P13) ---------------------

/** Sanitized view of a shared folder returned to a paired Android device (no folder_path). */
export interface AvailableFolderResponse {
  id: number;
  folder_name: string;
  total_size: number;
  file_count: number;
  shared_at: string;
}

/**
 * One child file of a shared folder (GET /folders/{id}/files), sanitized for
 * Android (no file_path). relative_path is POSIX-style (forward-slash),
 * relative to the folder root — NOT including the folder's own name.
 */
export interface AvailableFolderFileResponse {
  id: number;
  relative_path: string;
  file_size: number;
  mime_type: string | null;
}

// --- Transfers (app/schemas/transfer.py, app/models/enums.py) --------------

/** Direction is framed from the desktop's perspective: SEND = Android downloads, RECEIVE = Android uploads. */
export type TransferDirection = 'send' | 'receive';

/** Lifecycle state of a pending, not-yet-decided transfer request (app/services/transfer_manager.py). Never persisted server-side. */
export type TransferRequestStatus = 'pending' | 'accepted' | 'rejected';

/** Lifecycle state of a persisted Transfer row. */
export type TransferStatus = 'in_progress' | 'completed' | 'failed' | 'cancelled';

/**
 * Payload for POST /transfers/requests.
 * `shared_file_id` is required for direction "send"; `file_name`/`file_size`
 * are required for direction "receive" — enforced server-side, not here.
 *
 * folder_relative_path/upload_batch_id/upload_folder_name (P13) are only
 * ever set together, for one file of an Android folder upload — left unset
 * for an ordinary flat single-file upload or a "send" request.
 */
export interface TransferRequestCreate {
  direction: TransferDirection;
  shared_file_id?: number | null;
  file_name?: string | null;
  file_size?: number | null;
  folder_relative_path?: string | null;
  upload_batch_id?: string | null;
  upload_folder_name?: string | null;
}

/** A pending or already-decided transfer request, before any Transfer row exists. */
export interface TransferRequestResponse {
  request_id: string;
  direction: TransferDirection;
  status: TransferRequestStatus;
  device_id: number;
  device_name: string;
  shared_file_id: number | null;
  file_name: string;
  file_size: number;
  created_at: string;
  expires_at: string;
  transfer_id: number | null;
  folder_relative_path?: string | null;
  upload_batch_id?: string | null;
}

/** A persisted Transfer row. */
export interface TransferResponse {
  id: number;
  device_id: number | null;
  shared_file_id: number | null;
  direction: TransferDirection;
  file_name: string;
  file_size: number;
  device_name: string;
  status: TransferStatus;
  bytes_transferred: number;
  failure_reason: string | null;
  started_at: string;
  completed_at: string | null;
  /** P13: set only when this transfer belongs to a folder download/upload — see TransferRequestCreate. */
  shared_folder_id?: number | null;
  folder_relative_path?: string | null;
  upload_batch_id?: string | null;
}
