"use strict";

import * as devices from "./views/devices.js";
import * as pairing from "./views/pairing.js";
import * as files from "./views/files.js";
import * as transfers from "./views/transfers.js";
import * as settings from "./views/settings.js";

const views = { devices, pairing, files, transfers, settings };

const viewContainer = document.getElementById("view-container");
const backendStateEl = document.getElementById("backend-state");

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

window.relay.onBackendStatusChanged((state) => {
  backendStateEl.textContent = state;
});

window.relay.getBackendStatus().then((state) => {
  backendStateEl.textContent = state;
});

showView("devices");
