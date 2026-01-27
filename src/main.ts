/**
 * Music Assistant Remote Connection - Main Entry Point
 */

import {
  RemoteConnector,
  loadSavedConnection,
  clearSavedConnection,
  isValidRemoteId,
  getChannelFromVersion,
  redirectToFrontend,
} from "./broker";

// DOM Elements
const views = {
  loading: document.getElementById("loading")!,
  connect: document.getElementById("connect")!,
  connecting: document.getElementById("connecting")!,
  error: document.getElementById("error")!,
};

const elements = {
  savedConnection: document.getElementById("saved-connection")!,
  savedServerName: document.getElementById("saved-server-name")!,
  savedServerVersion: document.getElementById("saved-server-version")!,
  forgetBtn: document.getElementById("forget-btn")!,
  scanQrBtn: document.getElementById("scan-qr-btn")!,
  qrReader: document.getElementById("qr-reader")!,
  remoteIdInput: document.getElementById("remote-id-input") as HTMLInputElement,
  connectBtn: document.getElementById("connect-btn")!,
  connectingStatus: document.getElementById("connecting-status")!,
  cancelBtn: document.getElementById("cancel-btn")!,
  errorMessage: document.getElementById("error-message")!,
  retryBtn: document.getElementById("retry-btn")!,
};

let connector: RemoteConnector | null = null;
let currentRemoteId: string | null = null;

/**
 * Show a specific view, hide others
 */
function showView(viewName: keyof typeof views): void {
  Object.entries(views).forEach(([name, element]) => {
    if (name === viewName) {
      element.classList.remove("hidden");
    } else {
      element.classList.add("hidden");
    }
  });
}

/**
 * Update connecting status text
 */
function updateStatus(status: string): void {
  elements.connectingStatus.textContent = status;
}

/**
 * Show error view with message
 */
function showError(message: string): void {
  elements.errorMessage.textContent = message;

  // If there was a saved connection, show option to forget it
  const saved = loadSavedConnection();
  if (saved) {
    elements.savedConnection.classList.remove("hidden");
    elements.savedServerName.textContent = saved.serverName;
    elements.savedServerVersion.textContent = `v${saved.serverVersion} (${saved.channel})`;
  }

  showView("error");
}

/**
 * Initialize the connection flow
 */
async function connectToServer(remoteId: string): Promise<void> {
  currentRemoteId = remoteId;
  showView("connecting");

  connector = new RemoteConnector(updateStatus, showError);

  try {
    const serverInfo = await connector.connect(remoteId);

    updateStatus("Connected! Redirecting...");

    // Small delay to show success state
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Redirect to appropriate frontend
    const channel = getChannelFromVersion(serverInfo.server_version);
    redirectToFrontend(channel, remoteId);
  } catch (error) {
    connector?.disconnect();
    connector = null;

    if (error instanceof Error) {
      showError(error.message);
    } else {
      showError("Connection failed");
    }
  }
}

/**
 * Handle remote ID input changes
 */
function handleRemoteIdInput(): void {
  const value = elements.remoteIdInput.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
  elements.remoteIdInput.value = value;
  elements.connectBtn.toggleAttribute("disabled", !isValidRemoteId(value));
}

/**
 * Initialize the app
 */
function init(): void {
  // Always set up common event handlers
  setupEventHandlers();

  // Check for saved connection - auto-reconnect on return visits
  const saved = loadSavedConnection();

  if (saved) {
    // Show saved server info in the connecting view and auto-connect
    updateStatus(`Connecting to ${saved.serverName}...`);
    connectToServer(saved.remoteId);
    return; // Skip showing the connect view
  }

  // No saved connection - show connection UI
  showView("connect");
}

/**
 * Set up all event handlers
 */
function setupEventHandlers(): void {
  // Manual remote ID input
  elements.remoteIdInput.addEventListener("input", handleRemoteIdInput);
  elements.remoteIdInput.addEventListener("keypress", (e) => {
    if (e.key === "Enter" && isValidRemoteId(elements.remoteIdInput.value)) {
      connectToServer(elements.remoteIdInput.value);
    }
  });

  // Connect button
  elements.connectBtn.addEventListener("click", () => {
    const remoteId = elements.remoteIdInput.value;
    if (isValidRemoteId(remoteId)) {
      connectToServer(remoteId);
    }
  });

  // Cancel button
  elements.cancelBtn.addEventListener("click", () => {
    connector?.disconnect();
    connector = null;
    showView("connect");
  });

  // Retry button
  elements.retryBtn.addEventListener("click", () => {
    if (currentRemoteId) {
      connectToServer(currentRemoteId);
    } else {
      showView("connect");
    }
  });

  // Forget button (clears saved connection)
  elements.forgetBtn.addEventListener("click", () => {
    clearSavedConnection();
    elements.savedConnection.classList.add("hidden");
    showView("connect");
  });

  // QR scanner button (placeholder - would need a QR library)
  elements.scanQrBtn.addEventListener("click", () => {
    // TODO: Implement QR scanning
    // For now, just focus the manual input
    elements.remoteIdInput.focus();
    alert(
      "QR scanning coming soon!\n\nFor now, please enter your Remote ID manually."
    );
  });
}

// Start the app when DOM is ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
