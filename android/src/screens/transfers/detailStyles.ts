import { StyleSheet } from 'react-native';

/** Shared by TransferRequestDetail and TransferProgressDetail — same visual language, different data sources. */
export const detailStyles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 24,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  name: {
    fontSize: 20,
    fontWeight: '600',
  },
  meta: {
    marginTop: 4,
    color: '#666',
  },
  status: {
    marginTop: 12,
    fontSize: 16,
    fontWeight: '600',
  },
  error: {
    marginTop: 16,
    color: '#dc2626',
    textAlign: 'center',
  },
  button: {
    marginTop: 24,
    paddingVertical: 14,
    borderRadius: 8,
    backgroundColor: '#2563eb',
    alignItems: 'center',
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  dangerButton: {
    marginTop: 24,
    paddingVertical: 14,
    borderRadius: 8,
    backgroundColor: '#dc2626',
    alignItems: 'center',
  },
  dangerButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  progressTrack: {
    marginTop: 20,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#e5e7eb',
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#2563eb',
  },
});
