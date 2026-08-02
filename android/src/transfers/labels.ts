import { TransferDirection } from '../api/types';

/** Direction is framed from the desktop's perspective (backend/app/models/enums.py) — flip it for display on Android. */
export function directionLabel(direction: TransferDirection): string {
  return direction === 'send' ? 'Download' : 'Upload';
}

/** e.g. "in_progress" -> "In progress". */
export function formatStatus(status: string): string {
  const spaced = status.replace(/_/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
