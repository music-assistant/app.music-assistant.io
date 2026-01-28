/**
 * Remote Connector
 *
 * Establishes a WebRTC connection to a Music Assistant server to detect
 * its version/channel, then redirects to the matching frontend build.
 * This enables remote access to MA servers via app.music-assistant.io.
 */

import { SignalingClient, IceServerConfig } from "./signaling";
import {
  verifyAndSanitizeSdp,
  CertificateVerificationError,
} from "./crypto-utils";

const SIGNALING_SERVER_URL = "wss://signaling.music-assistant.io/ws";

// Fallback ICE servers (public STUN only)
const FALLBACK_ICE_SERVERS: IceServerConfig[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun.cloudflare.com:3478" },
];

export interface ServerInfo {
  server_id: string;
  server_version: string;
  schema_version: number;
  min_supported_schema_version: number;
  homeassistant_addon: boolean;
  server_name?: string;
}

export interface SavedConnection {
  remoteId: string;
  serverName: string;
  serverVersion: string;
  channel: "stable" | "beta" | "nightly";
  lastConnected: number;
}

const STORAGE_KEY = "ma_saved_connection";
// Frontend storage keys (for migration from existing users)
const FRONTEND_REMOTE_ID_KEY = "mass_remote_id";
const FRONTEND_TOKEN_KEY = "ma_access_token";

/**
 * Determine release channel from version string
 */
export function getChannelFromVersion(
  version: string
): "stable" | "beta" | "nightly" {
  // Dev instances report version 0.0.0
  if (version === "0.0.0") return "nightly";
  if (version.includes(".dev")) return "nightly";
  if (version.includes("b")) return "beta";
  return "stable";
}

/**
 * Save connection info to localStorage
 */
export function saveConnection(connection: SavedConnection): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(connection));
  // Also save the remote ID in the frontend's expected format for seamless handoff
  localStorage.setItem(FRONTEND_REMOTE_ID_KEY, connection.remoteId);
}

/**
 * Load saved connection from localStorage
 * Also checks for legacy frontend storage keys for migration
 */
export function loadSavedConnection(): SavedConnection | null {
  // First check our own storage
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored) {
    try {
      return JSON.parse(stored) as SavedConnection;
    } catch {
      // Continue to check frontend keys
    }
  }

  // Check for existing frontend remote ID (migration case)
  // This handles users who previously connected via the frontend directly
  const frontendRemoteId = localStorage.getItem(FRONTEND_REMOTE_ID_KEY);
  const hasToken = localStorage.getItem(FRONTEND_TOKEN_KEY);

  if (frontendRemoteId && hasToken && isValidRemoteId(frontendRemoteId)) {
    // We have a remote ID and token from the frontend
    // Return a partial SavedConnection that will trigger reconnect
    // The actual version/channel will be determined during connection
    return {
      remoteId: frontendRemoteId,
      serverName: "Saved Server",
      serverVersion: "unknown",
      channel: "stable", // Will be updated after connection
      lastConnected: 0,
    };
  }

  return null;
}

/**
 * Clear saved connection from localStorage
 */
export function clearSavedConnection(): void {
  localStorage.removeItem(STORAGE_KEY);
}

/**
 * Validate remote ID format (26 characters, alphanumeric)
 */
export function isValidRemoteId(remoteId: string): boolean {
  return /^[A-Z0-9]{26}$/i.test(remoteId);
}

/**
 * Remote Connector class
 * Establishes a temporary WebRTC connection to get server info,
 * then redirects to the appropriate frontend.
 */
export class RemoteConnector {
  private signaling: SignalingClient;
  private peerConnection: RTCPeerConnection | null = null;
  private dataChannel: RTCDataChannel | null = null;
  private iceServers: IceServerConfig[] = [];
  private iceCandidateBuffer: RTCIceCandidateInit[] = [];
  private remoteDescriptionSet = false;
  private currentRemoteId: string | null = null;

  private onStatusChange: (status: string) => void;
  private onError: (error: string) => void;

  constructor(
    onStatusChange: (status: string) => void,
    onError: (error: string) => void
  ) {
    this.onStatusChange = onStatusChange;
    this.onError = onError;
    this.signaling = new SignalingClient({
      serverUrl: SIGNALING_SERVER_URL,
    });
    this.setupSignalingHandlers();
  }

  /**
   * Connect to a Music Assistant server and get its info
   */
  async connect(remoteId: string): Promise<ServerInfo> {
    this.currentRemoteId = remoteId;
    this.onStatusChange("Connecting to signaling server...");

    try {
      // Connect to signaling server
      await this.signaling.connect();

      this.onStatusChange("Requesting connection...");

      // Request connection - receives ICE servers from MA server
      const { iceServers } = await this.signaling.requestConnection(remoteId);
      this.iceServers = iceServers || FALLBACK_ICE_SERVERS;

      this.onStatusChange("Establishing WebRTC connection...");

      // Create peer connection and data channel
      this.createPeerConnection();
      this.createDataChannel();

      // Create and send offer
      const offer = await this.peerConnection!.createOffer();
      await this.peerConnection!.setLocalDescription(offer);
      this.signaling.sendOffer(offer);

      // Wait for server info
      this.onStatusChange("Waiting for server response...");
      const serverInfo = await this.waitForServerInfo(remoteId);

      return serverInfo;
    } catch (error) {
      this.cleanup();
      throw error;
    }
  }

  /**
   * Disconnect and cleanup
   */
  disconnect(): void {
    this.cleanup();
  }

  private setupSignalingHandlers(): void {
    this.signaling.on("answer", (answer) => {
      this.handleAnswer(answer);
    });

    this.signaling.on("ice-candidate", (candidate) => {
      this.handleIceCandidate(candidate);
    });

    this.signaling.on("peer-disconnected", () => {
      this.onError("Server disconnected");
      this.cleanup();
    });

    this.signaling.on("error", (error) => {
      this.onError(error);
    });
  }

  private createPeerConnection(): void {
    this.peerConnection = new RTCPeerConnection({
      iceServers: this.iceServers,
      iceCandidatePoolSize: 4,
    });

    this.peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        this.signaling.sendIceCandidate(event.candidate.toJSON());
      }
    };

    this.peerConnection.oniceconnectionstatechange = () => {
      const state = this.peerConnection?.iceConnectionState;
      if (state === "failed" || state === "disconnected") {
        this.onError("Connection failed");
        this.cleanup();
      }
    };
  }

  private createDataChannel(): void {
    this.dataChannel = this.peerConnection!.createDataChannel("ma-api", {
      ordered: true,
    });
  }

  private async handleAnswer(answer: RTCSessionDescriptionInit): Promise<void> {
    if (!this.peerConnection || !this.currentRemoteId) return;

    try {
      // Verify certificate fingerprint against the remote ID
      const sdp = verifyAndSanitizeSdp(answer.sdp, this.currentRemoteId);

      await this.peerConnection.setRemoteDescription(
        new RTCSessionDescription({ type: answer.type, sdp })
      );
      this.remoteDescriptionSet = true;

      // Process buffered ICE candidates
      for (const candidate of this.iceCandidateBuffer) {
        await this.peerConnection.addIceCandidate(
          new RTCIceCandidate(candidate)
        );
      }
      this.iceCandidateBuffer = [];
    } catch (error) {
      if (error instanceof CertificateVerificationError) {
        this.onError("Security verification failed: " + error.message);
      } else {
        this.onError("Connection error: " + (error as Error).message);
      }
      this.cleanup();
    }
  }

  private async handleIceCandidate(
    candidate: RTCIceCandidateInit
  ): Promise<void> {
    if (!this.peerConnection) return;

    if (this.remoteDescriptionSet) {
      try {
        await this.peerConnection.addIceCandidate(
          new RTCIceCandidate(candidate)
        );
      } catch (error) {
        console.error("Error adding ICE candidate:", error);
      }
    } else {
      this.iceCandidateBuffer.push(candidate);
    }
  }

  private waitForServerInfo(remoteId: string): Promise<ServerInfo> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Timeout waiting for server info"));
      }, 30000);

      // Wait for data channel to open
      const checkOpen = () => {
        if (this.dataChannel?.readyState === "open") {
          // Data channel is open, listen for first message (server info)
          this.dataChannel.onmessage = (event) => {
            clearTimeout(timeout);
            try {
              const serverInfo = JSON.parse(event.data) as ServerInfo;

              // Save connection info
              const channel = getChannelFromVersion(serverInfo.server_version);
              saveConnection({
                remoteId,
                serverName:
                  serverInfo.server_name || `MA Server ${serverInfo.server_id}`,
                serverVersion: serverInfo.server_version,
                channel,
                lastConnected: Date.now(),
              });

              resolve(serverInfo);
            } catch (error) {
              reject(new Error("Invalid server response"));
            }
          };
        }
      };

      if (this.dataChannel) {
        this.dataChannel.onopen = checkOpen;
        // Check if already open
        if (this.dataChannel.readyState === "open") {
          checkOpen();
        }
      }

      this.dataChannel!.onerror = () => {
        clearTimeout(timeout);
        reject(new Error("Data channel error"));
      };
    });
  }

  private cleanup(): void {
    if (this.dataChannel) {
      this.dataChannel.close();
      this.dataChannel = null;
    }

    if (this.peerConnection) {
      this.peerConnection.close();
      this.peerConnection = null;
    }

    this.signaling.disconnect();
    this.remoteDescriptionSet = false;
    this.iceCandidateBuffer = [];
    this.currentRemoteId = null;
  }
}

/**
 * Redirect to the appropriate frontend based on channel
 */
export function redirectToFrontend(
  channel: "stable" | "beta" | "nightly",
  remoteId: string
): void {
  const url = `/${channel}/?remote_id=${encodeURIComponent(remoteId)}`;
  window.location.href = url;
}
