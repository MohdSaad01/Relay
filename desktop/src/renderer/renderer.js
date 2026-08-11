"use strict";

import { api } from "./api/client.js";
import * as devices from "./views/devices.js";
import * as pairing from "./views/pairing.js";
import * as files from "./views/files.js";
import * as transfers from "./views/transfers.js";
import * as settings from "./views/settings.js";

const views = { devices, pairing, files, transfers, settings };

const viewContainer = document.getElementById("view-container");

let activeUnmount = null;

async function showView(name) {
  document.querySelectorAll("#nav button").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === name);
  });

  if (activeUnmount) {
    activeUnmount();
    activeUnmount = null;
  }
  viewContainer.innerHTML = "";
  activeUnmount = (await views[name].mount(viewContainer)) ?? null;
}

document.querySelectorAll("#nav button").forEach((button) => {
  button.addEventListener("click", () => showView(button.dataset.view));
});

/**
 * P19: land on Pairing instead of Devices when nothing is paired yet, so the
 * user isn't shown an empty Devices screen only to be told to go pair a
 * device. Manual navigation is unaffected - this only picks the tab shown
 * on startup. Any lookup failure (e.g. backend not ready yet) falls back to
 * the previous default of Devices rather than guessing.
 */
async function determineInitialView() {
  try {
    const { data: pairedDevices } = await api.get("/devices");
    return pairedDevices.length === 0 ? "pairing" : "devices";
  } catch {
    return "devices";
  }
}

determineInitialView().then(showView);
