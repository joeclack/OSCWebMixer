"use strict";

const loadingEl = document.getElementById("loading");
const contentEl = document.getElementById("content");
const errorEl = document.getElementById("error");
const connectionsEl = document.getElementById("connections");
const authStatusEl = document.getElementById("authStatus");
const auxCountEl = document.getElementById("auxCount");
const channelCountEl = document.getElementById("channelCount");
const mixerUrlEl = document.getElementById("mixerUrl");
const copyUrlBtn = document.getElementById("copyUrl");
const qrCodeEl = document.getElementById("qrCode");
const auxTableEl = document.getElementById("auxTable");
const channelTableEl = document.getElementById("channelTable");
const clientsListEl = document.getElementById("clientsList");
const noClientsEl = document.getElementById("noClients");
const disconnectedSectionEl = document.getElementById("disconnectedSection");
const disconnectedClientsListEl = document.getElementById(
  "disconnectedClientsList",
);
const auxMenuEl = document.getElementById("auxMenu");
const liveMixPanelEl = document.getElementById("liveMixPanel");
const liveMixFoldEl = document.getElementById("liveMixFold");
const liveMixSummaryEl = document.getElementById("liveMixSummary");
const liveMixHintEl = document.getElementById("liveMixHint");
const liveMixTitleEl = document.getElementById("liveMixTitle");
const liveMixChannelsEl = document.getElementById("liveMixChannels");
const panToggleEl = document.getElementById("panToggle");
const panToggleLabelEl = document.getElementById("panToggleLabel");
const sidebarNavEl = document.getElementById("sidebarNav");
const sidebarToggleEl = document.getElementById("sidebarToggle");
const pageTitleEl = document.getElementById("pageTitle");
const pageEls = document.querySelectorAll(".page");
const navItemEls = document.querySelectorAll(".nav-item");

const pageTitles = {
  overview: "Overview",
  "live-mix": "Live mix",
  clients: "Clients",
  config: "Config",
};

const logIcons = {
  aux: `<svg class="log-icon" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2 3 7v13c0 .55.45 1 1 1h14c.55 0 1-.45 1-1V7l-9-5zm0 2.18 7 3.89v10.93H5V8.07l7-3.89zM8 11h8v2H8v-2z"/></svg>`,
  level: `<svg class="log-icon" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M4 18V6h2v12H4zm5 0V10h2v8H9zm5 0V4h2v14h-2zm5 0v-6h2v6h-2z"/></svg>`,
  pan: `<svg class="log-icon" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M8 12H3l4.5-4.5V11h3V5.5L15 10h-3v5.5L11.5 11H8v1zm8 0h5l-4.5 4.5V13h-3v5.5L9 14h3v-1z"/></svg>`,
};

let currentUrl = "";
let auxOptions = [];
let mixLevels = {};
let selectedAux = sessionStorage.getItem("adminSelectedAux");
let showPan = sessionStorage.getItem("adminShowPan") === "true";
let currentPage =
  window.location.hash.replace("#", "") ||
  sessionStorage.getItem("adminPage") ||
  "overview";

function showPage(page) {
  if (!pageTitles[page]) {
    page = "overview";
  }

  currentPage = page;
  sessionStorage.setItem("adminPage", page);
  window.location.hash = page;

  pageTitleEl.textContent = pageTitles[page];

  pageEls.forEach((el) => {
    el.classList.toggle("active", el.dataset.page === page);
  });

  navItemEls.forEach((el) => {
    el.classList.toggle("active", el.dataset.page === page);
  });

  document.body.classList.remove("sidebar-open");
}

function formatTime(timestamp) {
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 60) {
    return `${seconds}s ago`;
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

function formatLevel(level) {
  if (level == null) {
    return "—";
  }
  return `${Math.round(level * 100)}%`;
}

function formatPan(pan) {
  if (pan == null) {
    return "";
  }
  if (pan === 0) {
    return "C";
  }
  return pan < 0 ? `L ${Math.abs(Math.round(pan * 100))}` : `R ${Math.round(pan * 100)}`;
}

function formatClock(timestamp) {
  return new Date(timestamp).toLocaleTimeString();
}

function restoreFoldable(el, storageKey, defaultOpen = true) {
  const saved = sessionStorage.getItem(storageKey);
  el.open = saved === null ? defaultOpen : saved === "true";
}

const boundFoldables = new WeakSet();

function bindFoldable(el, storageKey, defaultOpen = true) {
  restoreFoldable(el, storageKey, defaultOpen);

  if (boundFoldables.has(el)) {
    return;
  }

  boundFoldables.add(el);
  el.addEventListener("toggle", () => {
    sessionStorage.setItem(storageKey, String(el.open));
  });
}

function coalesceClientLog(log) {
  if (!log?.length) {
    return [];
  }

  const coalesced = [];

  for (const entry of log) {
    const previous = coalesced[coalesced.length - 1];
    const sameGroup =
      previous &&
      previous.type === entry.type &&
      previous.aux === entry.aux &&
      (entry.type === "aux" || previous.channel === entry.channel);

    if (sameGroup) {
      previous.at = entry.at;
      previous.toValue = entry.value;
      previous.count += 1;
      continue;
    }

    coalesced.push({
      ...entry,
      fromValue:
        entry.previousValue != null ? entry.previousValue : entry.value,
      toValue: entry.value,
      count: 1,
    });
  }

  return coalesced.reverse();
}

function formatLogValue(type, value) {
  if (type === "level") {
    return formatLevel(value);
  }
  if (type === "pan") {
    return formatPan(value) || "C";
  }
  return String(value);
}

function formatLogEntryText(entry) {
  const auxName = entry.auxLabel || `AUX ${entry.aux}`;
  const channelName = entry.channelLabel || `Ch ${entry.channel}`;

  if (entry.type === "aux") {
    return `<strong>${auxName}</strong>`;
  }

  const fromValue = entry.fromValue;
  const toValue = entry.toValue ?? entry.value;
  const hasRange =
    fromValue != null && Math.abs(fromValue - toValue) > 0.005;

  const changed = hasRange
    ? `${formatLogValue(entry.type, fromValue)} → ${formatLogValue(entry.type, toValue)}`
    : formatLogValue(entry.type, toValue);

  const suffix =
    entry.count > 1 && !hasRange
      ? `<span class="log-count">${entry.count} changes</span>`
      : "";

  if (entry.type === "level") {
    return `<strong>${channelName}</strong> · ${changed} · ${auxName}${suffix}`;
  }

  return `<strong>${channelName}</strong> · ${changed} · ${auxName}${suffix}`;
}

function renderClientLog(log) {
  const entries = coalesceClientLog(log);

  if (!entries.length) {
    return '<p class="muted">No changes yet.</p>';
  }

  return `<ol class="client-log">
    ${entries
      .map(
        (entry) => `<li class="log-entry log-entry-${entry.type}">
          <span class="log-icon-wrap">${logIcons[entry.type] || ""}</span>
          <time>${formatClock(entry.at)}</time>
          <span class="log-text">${formatLogEntryText(entry)}</span>
        </li>`,
      )
      .join("")}
  </ol>`;
}

function renderClientLevels(levels) {
  if (!levels || levels.length === 0) {
    return '<p class="muted">No AUX selected yet.</p>';
  }

  const activeLevels = levels.filter((entry) => entry.level != null);
  if (activeLevels.length === 0) {
    return '<p class="muted">Waiting for desk values…</p>';
  }

  return `<table class="client-levels">
    <thead>
      <tr>
        <th>Channel</th>
        <th>Label</th>
        <th>Level</th>
        <th></th>
      </tr>
    </thead>
    <tbody>
      ${activeLevels
        .map((entry) => {
          const panText = formatPan(entry.pan);
          return `<tr>
            <td>${entry.channel}</td>
            <td>${entry.label || "—"}</td>
            <td>${formatLevel(entry.level)}${panText ? ` · ${panText}` : ""}</td>
            <td class="level-cell">
              <div class="level-bar">
                <div class="level-bar-fill" style="width: ${Math.round((entry.level || 0) * 100)}%"></div>
              </div>
            </td>
          </tr>`;
        })
        .join("")}
    </tbody>
  </table>`;
}

function renderClientCard(client, disconnected = false) {
  const auxName =
    client.auxLabel ||
    (client.aux != null ? `AUX ${client.aux}` : "No AUX selected");
  const personLabel = client.personName
    ? `<span class="client-person">${client.personName}</span>`
    : "";
  const auxColour = client.auxColour
    ? `style="--client-tint: ${client.auxColour}"`
    : "";
  const statusText = disconnected
    ? `Disconnected ${formatTime(client.disconnectedAt)}`
    : `Active ${formatTime(client.lastActivity)}`;

  return `<article class="client-card${disconnected ? " client-card-disconnected" : ""}" data-client-id="${client.id}" ${auxColour}>
    <div class="client-header">
      <div>
        <strong>Client ${client.id}</strong>
        ${personLabel}
        <span class="muted">${client.address || "Unknown address"}</span>
      </div>
      <div class="client-meta">
        <span class="client-aux">${auxName}</span>
        <span class="muted">${statusText}</span>
      </div>
    </div>
    <details class="foldable client-fold" data-section="mix">
      <summary>Current mix</summary>
      <div class="foldable-body">
        ${renderClientLevels(client.levels)}
      </div>
    </details>
    <details class="foldable client-fold" data-section="log">
      <summary>Changelog (${coalesceClientLog(client.log || []).length})</summary>
      <div class="foldable-body">
        ${renderClientLog(client.log)}
      </div>
    </details>
  </article>`;
}

function bindClientFoldables(container) {
  container.querySelectorAll(".client-fold").forEach((el) => {
    const clientId = el.closest(".client-card")?.dataset.clientId;
    const section = el.dataset.section;
    bindFoldable(el, `adminClientFold-${clientId}-${section}`);
  });
}

function renderClients(connected, disconnected) {
  noClientsEl.hidden = connected.length > 0;
  clientsListEl.innerHTML = connected.map((client) => renderClientCard(client)).join("");
  bindClientFoldables(clientsListEl);

  if (!disconnected.length) {
    disconnectedSectionEl.hidden = true;
    disconnectedClientsListEl.innerHTML = "";
    return;
  }

  disconnectedSectionEl.hidden = false;
  disconnectedClientsListEl.innerHTML = disconnected
    .map((client) => renderClientCard(client, true))
    .join("");
  bindClientFoldables(disconnectedClientsListEl);
}

function getAuxLabel(aux) {
  return aux.label || `AUX ${aux.channel}`;
}

function renderAuxMenu() {
  auxMenuEl.innerHTML = auxOptions
    .map((aux) => {
      const active = String(aux.channel) === String(selectedAux);
      return `<button type="button" class="aux-menu-btn${active ? " active" : ""}" data-channel="${aux.channel}" style="--aux-tint: ${aux.colour}">
        ${getAuxLabel(aux)}
      </button>`;
    })
    .join("");
}

function renderLiveMixChannels(levels, stereo) {
  if (!levels) {
    liveMixChannelsEl.innerHTML = '<p class="muted">Waiting for desk values…</p>';
    return;
  }

  const visibleLevels = levels.filter((entry) => entry.level != null);
  if (!visibleLevels.length) {
    liveMixChannelsEl.innerHTML = '<p class="muted">Waiting for desk values…</p>';
    return;
  }

  liveMixChannelsEl.innerHTML = visibleLevels
    .map((entry) => {
      const levelPercent = Math.round((entry.level || 0) * 100);
      const panStyle =
        entry.pan == null ? "0%" : `${Math.round(entry.pan * 100)}%`;

      return `<div class="live-channel">
        <label class="mixer-fader volume" style="--value: ${levelPercent}%">
          <span>${entry.label || `Ch ${entry.channel}`}</span>
          <div class="fader-track"><div class="fader-fill"></div></div>
        </label>
        ${
          stereo
            ? `<label class="mixer-fader pan-display${showPan ? "" : " hidden"}" style="--value: ${panStyle}">
          <span>${entry.label || `Ch ${entry.channel}`}</span>
          <div class="pan-track"></div>
          <span class="pan-readout">${formatPan(entry.pan)}</span>
        </label>`
            : ""
        }
      </div>`;
    })
    .join("");
}

function renderLiveMix() {
  const aux = auxOptions.find(
    (entry) => String(entry.channel) === String(selectedAux),
  );

  if (!aux) {
    liveMixFoldEl.hidden = true;
    liveMixHintEl.hidden = false;
    return;
  }

  liveMixHintEl.hidden = true;
  liveMixFoldEl.hidden = false;
  restoreFoldable(liveMixFoldEl, "adminLiveMixFold", false);
  liveMixTitleEl.textContent = getAuxLabel(aux);
  liveMixSummaryEl.textContent = `Live sends · ${getAuxLabel(aux)}`;
  document.body.style.setProperty("--live-tint", aux.colour);

  panToggleLabelEl.hidden = !aux.stereo;
  panToggleEl.checked = showPan && aux.stereo;

  renderLiveMixChannels(mixLevels[aux.channel], aux.stereo);
}

function selectAux(channel) {
  selectedAux = String(channel);
  sessionStorage.setItem("adminSelectedAux", selectedAux);
  renderAuxMenu();
  renderLiveMix();
}

function renderStatus(data) {
  loadingEl.hidden = true;
  errorEl.hidden = true;
  contentEl.hidden = false;

  currentUrl = data.url;
  connectionsEl.textContent = String(data.connections);
  authStatusEl.textContent = data.authEnabled ? "Enabled" : "Disabled";
  auxCountEl.textContent = String(data.aux.length);
  channelCountEl.textContent = String(data.channels.length);

  auxOptions = data.aux || [];
  mixLevels = data.mixLevels || {};

  if (
    selectedAux &&
    !auxOptions.some((entry) => String(entry.channel) === String(selectedAux))
  ) {
    selectedAux = null;
    sessionStorage.removeItem("adminSelectedAux");
  }

  if (!selectedAux && auxOptions.length) {
    selectedAux = String(auxOptions[0].channel);
    sessionStorage.setItem("adminSelectedAux", selectedAux);
  }

  renderAuxMenu();
  renderLiveMix();

  renderClients(data.clients || [], data.disconnectedClients || []);

  mixerUrlEl.href = data.url;
  mixerUrlEl.textContent = data.url;
  qrCodeEl.src = data.qr;

  auxTableEl.innerHTML = data.aux
    .map(
      (aux) => `<tr>
        <td><span class="colour-dot" style="background: rgb(${aux.colour})"></span>${aux.channel}</td>
        <td>${aux.label || "—"}</td>
        <td>${aux.stereo ? "Yes" : "No"}</td>
      </tr>`,
    )
    .join("");

  channelTableEl.innerHTML = data.channels
    .map(
      (channel) => `<tr>
        <td>${channel.channel}</td>
        <td>${channel.label || "—"}</td>
      </tr>`,
    )
    .join("");
}

async function loadStatus() {
  try {
    const response = await fetch("/api/admin/status");
    if (!response.ok) {
      throw new Error("Request failed");
    }
    renderStatus(await response.json());
  } catch {
    loadingEl.hidden = true;
    contentEl.hidden = true;
    errorEl.hidden = false;
  }
}

copyUrlBtn.addEventListener("click", async () => {
  if (!currentUrl) {
    return;
  }

  try {
    await navigator.clipboard.writeText(currentUrl);
    copyUrlBtn.textContent = "Copied";
    setTimeout(() => {
      copyUrlBtn.textContent = "Copy";
    }, 1500);
  } catch {
    copyUrlBtn.textContent = "Copy failed";
    setTimeout(() => {
      copyUrlBtn.textContent = "Copy";
    }, 1500);
  }
});

auxMenuEl.addEventListener("click", (event) => {
  const button = event.target.closest("[data-channel]");
  if (!button) {
    return;
  }
  selectAux(button.dataset.channel);
});

panToggleEl.addEventListener("change", () => {
  showPan = panToggleEl.checked;
  sessionStorage.setItem("adminShowPan", String(showPan));
  renderLiveMix();
});

sidebarNavEl.addEventListener("click", (event) => {
  const button = event.target.closest("[data-page]");
  if (!button) {
    return;
  }
  showPage(button.dataset.page);
});

sidebarToggleEl.addEventListener("click", () => {
  document.body.classList.toggle("sidebar-open");
});

window.addEventListener("hashchange", () => {
  const page = window.location.hash.replace("#", "");
  if (page && page !== currentPage) {
    showPage(page);
  }
});

showPage(currentPage);
bindFoldable(liveMixFoldEl, "adminLiveMixFold", false);
loadStatus();
setInterval(loadStatus, 2000);
