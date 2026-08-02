"use strict";

/**
 * Thin fetch wrapper around the backend's ApiResponse envelope
 * ({ success, message, data }). The renderer talks to the backend directly
 * over loopback HTTP — see backend/README.md's Authentication Infrastructure
 * section: the desktop is the trusted loopback caller, so no auth header is
 * sent here.
 */

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

let baseUrlPromise = null;

function getBaseUrl() {
  if (!baseUrlPromise) {
    baseUrlPromise = window.relay.getBackendBaseUrl();
  }
  return baseUrlPromise;
}

async function request(method, path, body) {
  const baseUrl = await getBaseUrl();
  const options = { method };
  if (body !== undefined) {
    options.headers = { "Content-Type": "application/json" };
    options.body = JSON.stringify(body);
  }

  let response;
  try {
    response = await fetch(`${baseUrl}${path}`, options);
  } catch (err) {
    throw new ApiError(`Could not reach the backend: ${err.message}`, 0);
  }

  if (response.status === 204) {
    return { success: true, message: "", data: null };
  }

  const envelope = await response.json();
  if (!response.ok || envelope.success === false) {
    throw new ApiError(envelope.message || `Request failed (${response.status}).`, response.status);
  }
  return envelope;
}

export const api = {
  get: (path) => request("GET", path),
  post: (path, body) => request("POST", path, body ?? {}),
  patch: (path, body) => request("PATCH", path, body ?? {}),
  del: (path) => request("DELETE", path),
};
