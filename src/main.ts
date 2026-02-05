/**
 * Music Assistant Remote Connection - Main Entry Point
 */

import "./style.css";
import {
  RemoteConnector,
  loadSavedConnection,
  clearSavedConnection,
  getChannelFromVersion,
  redirectToFrontend,
} from "./broker";

// Remote ID segment lengths: 8-5-5-8 (total 26 characters)
const REMOTE_ID_LENGTHS = [8, 5, 5, 8];

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
  remoteIdInputs: [
    document.getElementById("remote-id-0") as HTMLInputElement,
    document.getElementById("remote-id-1") as HTMLInputElement,
    document.getElementById("remote-id-2") as HTMLInputElement,
    document.getElementById("remote-id-3") as HTMLInputElement,
  ],
  connectBtn: document.getElementById("connect-btn")!,
  connectingStatus: document.getElementById("connecting-status")!,
  cancelBtn: document.getElementById("cancel-btn")!,
  errorMessage: document.getElementById("error-message")!,
  retryBtn: document.getElementById("retry-btn")!,
  // QR dialog elements
  qrDialog: document.getElementById("qr-dialog")!,
  qrReader: document.getElementById("qr-reader")!,
  closeQrBtn: document.getElementById("close-qr-btn")!,
  qrError: document.getElementById("qr-error")!,
};

let connector: RemoteConnector | null = null;
let currentRemoteId: string | null = null;
let html5QrCode: any = null;

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
 * Get the full remote ID from all input fields
 */
function getFullRemoteId(): string {
  return elements.remoteIdInputs.map((input) => input.value).join("");
}

/**
 * Check if all remote ID fields are fully filled
 */
function isRemoteIdComplete(): boolean {
  return elements.remoteIdInputs.every(
    (input, index) => input.value.length === REMOTE_ID_LENGTHS[index]
  );
}

/**
 * Update connect button state based on input completeness
 */
function updateConnectButtonState(): void {
  const isComplete = isRemoteIdComplete();
  elements.connectBtn.toggleAttribute("disabled", !isComplete);
}

/**
 * Set remote ID from a full string (e.g., from localStorage or QR)
 */
function setRemoteIdFromString(value: string): void {
  // Remove dashes and non-alphanumeric, convert to uppercase
  const cleanText = value.toUpperCase().replace(/[^A-Z0-9]/g, "");
  let remaining = cleanText;

  for (let i = 0; i < 4; i++) {
    const maxLen = REMOTE_ID_LENGTHS[i];
    elements.remoteIdInputs[i].value = remaining.slice(0, maxLen);
    remaining = remaining.slice(maxLen);
  }

  updateConnectButtonState();
}

/**
 * Distribute text across remote ID fields starting from a given index
 */
function distributeRemoteIdText(text: string, startIndex: number): void {
  let remaining = text.toUpperCase().replace(/[^A-Z0-9]/g, "");
  let focusIndex = startIndex;

  for (let i = startIndex; i < 4 && remaining.length > 0; i++) {
    const maxLen = REMOTE_ID_LENGTHS[i];
    elements.remoteIdInputs[i].value = remaining.slice(0, maxLen);
    if (remaining.length <= maxLen) {
      focusIndex = i;
    }
    remaining = remaining.slice(maxLen);
  }

  // Focus the appropriate field and position cursor at end
  const field = elements.remoteIdInputs[focusIndex];
  field?.focus();
  const len = field?.value.length || 0;
  field?.setSelectionRange(len, len);

  updateConnectButtonState();
}

/**
 * Handle input in remote ID segmented fields
 */
function handleRemoteIdInput(index: number, event: Event): void {
  const input = event.target as HTMLInputElement;
  // Convert to uppercase and remove non-alphanumeric characters
  let value = input.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const maxLen = REMOTE_ID_LENGTHS[index];

  if (value.length > maxLen) {
    // Overflow: put excess in next field(s)
    const overflow = value.slice(maxLen);
    value = value.slice(0, maxLen);
    input.value = value;

    if (index < 3 && overflow) {
      distributeRemoteIdText(overflow, index + 1);
    }
  } else {
    input.value = value;

    // Auto-advance to next field when current is full
    if (value.length === maxLen && index < 3) {
      elements.remoteIdInputs[index + 1]?.focus();
    }
  }

  updateConnectButtonState();
}

/**
 * Handle keydown in remote ID fields (for backspace/arrow navigation)
 */
function handleRemoteIdKeydown(index: number, event: KeyboardEvent): void {
  const input = event.target as HTMLInputElement;

  if (
    event.key === "Backspace" &&
    input.selectionStart === 0 &&
    input.selectionEnd === 0 &&
    index > 0
  ) {
    // Backspace at start of field: move to previous field
    event.preventDefault();
    const prevField = elements.remoteIdInputs[index - 1];
    prevField?.focus();
    const len = prevField?.value.length || 0;
    prevField?.setSelectionRange(len, len);
  } else if (
    event.key === "ArrowLeft" &&
    input.selectionStart === 0 &&
    index > 0
  ) {
    // Left arrow at start: move to previous field
    event.preventDefault();
    const prevField = elements.remoteIdInputs[index - 1];
    prevField?.focus();
    const len = prevField?.value.length || 0;
    prevField?.setSelectionRange(len, len);
  } else if (
    event.key === "ArrowRight" &&
    input.selectionStart === input.value.length &&
    index < 3
  ) {
    // Right arrow at end: move to next field
    event.preventDefault();
    const nextField = elements.remoteIdInputs[index + 1];
    nextField?.focus();
    nextField?.setSelectionRange(0, 0);
  } else if (event.key === "Enter") {
    // Enter: submit if complete
    if (isRemoteIdComplete()) {
      connectToServer(getFullRemoteId());
    }
  }
}

/**
 * Handle paste in remote ID fields
 */
function handleRemoteIdPaste(index: number, event: ClipboardEvent): void {
  event.preventDefault();
  const pastedText = event.clipboardData?.getData("text") || "";
  // Remove dashes and non-alphanumeric, convert to uppercase
  const cleanText = pastedText.toUpperCase().replace(/[^A-Z0-9]/g, "");

  if (cleanText) {
    // If pasting into first field, replace all fields
    if (index === 0) {
      // Clear all fields and distribute
      elements.remoteIdInputs.forEach((input) => (input.value = ""));
      distributeRemoteIdText(cleanText, 0);
    } else {
      // Distribute from current field
      distributeRemoteIdText(cleanText, index);
    }
  }
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
 * Open QR scanner dialog
 */
async function openQrScanner(): Promise<void> {
  elements.qrDialog.classList.remove("hidden");
  elements.qrError.classList.add("hidden");
  elements.qrError.textContent = "";

  // Dynamically import html5-qrcode
  try {
    const { Html5Qrcode } = await import("html5-qrcode");

    html5QrCode = new Html5Qrcode("qr-reader");

    await html5QrCode.start(
      { facingMode: "environment" },
      {
        fps: 10,
        qrbox: { width: 250, height: 250 },
        aspectRatio: 1.0,
      },
      onQrCodeSuccess,
      () => {} // Ignore scan failures
    );
  } catch (error) {
    console.error("QR scanner error:", error);
    showQrError("Could not access camera. Please check permissions.");
  }
}

/**
 * Close QR scanner dialog
 */
async function closeQrScanner(): Promise<void> {
  elements.qrDialog.classList.add("hidden");

  if (html5QrCode) {
    try {
      await html5QrCode.stop();
    } catch {
      // Ignore stop errors
    }
    html5QrCode = null;
  }
}

/**
 * Show QR scanner error
 */
function showQrError(message: string): void {
  elements.qrError.textContent = message;
  elements.qrError.classList.remove("hidden");
}

/**
 * Handle successful QR code scan
 */
async function onQrCodeSuccess(decodedText: string): Promise<void> {
  console.debug("QR code detected:", decodedText);

  // Try to extract remote_id from the QR code
  let extractedRemoteId: string | null = null;

  // Check if it's a URL with remote_id parameter
  try {
    const url = new URL(decodedText);
    extractedRemoteId = url.searchParams.get("remote_id");
  } catch {
    // Not a URL, check if it's a raw remote ID (26 alphanumeric characters)
    const cleanData = decodedText.toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (cleanData.length === 26) {
      extractedRemoteId = cleanData;
    }
  }

  if (extractedRemoteId) {
    console.debug("Extracted remote ID:", extractedRemoteId);
    await closeQrScanner();
    setRemoteIdFromString(extractedRemoteId);
    // Auto-connect after scanning
    connectToServer(extractedRemoteId);
  } else {
    showQrError(
      "Invalid QR code. Please scan a Music Assistant remote ID QR code."
    );
  }
}

/**
 * Initialize the app
 */
function init(): void {
  // Always set up common event handlers
  setupEventHandlers();

  // Check for saved connection - redirect directly if we know the channel
  const saved = loadSavedConnection();

  if (saved && saved.channel && saved.serverVersion !== "unknown") {
    // We have a complete saved connection with a known channel
    // Redirect directly to the channel instead of reconnecting
    console.log(`Redirecting to saved channel: ${saved.channel}`);
    redirectToFrontend(saved.channel, saved.remoteId);
    return;
  }

  if (saved) {
    // We have a remote ID but don't know the channel yet (migration case)
    // Need to connect to determine the channel
    setRemoteIdFromString(saved.remoteId);
    updateStatus(`Connecting to ${saved.serverName}...`);
    connectToServer(saved.remoteId);
    return;
  }

  // No saved connection - show connection UI
  showView("connect");
  // Focus first input field
  elements.remoteIdInputs[0]?.focus();
}

/**
 * Set up all event handlers
 */
function setupEventHandlers(): void {
  // Segmented remote ID inputs
  elements.remoteIdInputs.forEach((input, index) => {
    input.addEventListener("input", (e) => handleRemoteIdInput(index, e));
    input.addEventListener("keydown", (e) => handleRemoteIdKeydown(index, e));
    input.addEventListener("paste", (e) => handleRemoteIdPaste(index, e));
  });

  // Connect button
  elements.connectBtn.addEventListener("click", () => {
    if (isRemoteIdComplete()) {
      connectToServer(getFullRemoteId());
    }
  });

  // Cancel button
  elements.cancelBtn.addEventListener("click", () => {
    connector?.disconnect();
    connector = null;
    showView("connect");
    elements.remoteIdInputs[0]?.focus();
  });

  // Retry button
  elements.retryBtn.addEventListener("click", () => {
    if (currentRemoteId) {
      connectToServer(currentRemoteId);
    } else {
      showView("connect");
      elements.remoteIdInputs[0]?.focus();
    }
  });

  // Forget button (clears saved connection)
  elements.forgetBtn.addEventListener("click", () => {
    clearSavedConnection();
    elements.savedConnection.classList.add("hidden");
    showView("connect");
    elements.remoteIdInputs[0]?.focus();
  });

  // QR scanner button
  elements.scanQrBtn.addEventListener("click", openQrScanner);

  // Close QR dialog button
  elements.closeQrBtn.addEventListener("click", closeQrScanner);

  // Close QR dialog on overlay click
  elements.qrDialog.addEventListener("click", (e) => {
    if (e.target === elements.qrDialog) {
      closeQrScanner();
    }
  });

  // Close QR dialog on Escape key
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !elements.qrDialog.classList.contains("hidden")) {
      closeQrScanner();
    }
  });
}

// Start the app when DOM is ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
