# Music Assistant - Remote Connection Portal

This repository hosts the remote connection portal for Music Assistant at [app.music-assistant.io](https://app.music-assistant.io).

## Purpose

This portal enables remote WebRTC access to Music Assistant servers by:

1. **Handling initial remote connections** - Users scan a QR code or enter their Remote ID
2. **Detecting server version** - Establishes a brief WebRTC connection to get server info
3. **Routing to correct frontend** - Redirects to the appropriate frontend build (stable/beta/nightly)
4. **Remembering connections** - Saves connection info in localStorage for auto-reconnect

## Architecture

```
app.music-assistant.io/
├── index.html          # Connection portal (QR scanner, manual entry)
├── stable/             # Frontend build for stable channel
├── beta/               # Frontend build for beta channel
└── nightly/            # Frontend build for nightly channel
```

### Connection Flow

```
First Visit:
1. User enters Remote ID or scans QR code
2. Portal establishes WebRTC connection
3. Server sends its version info
4. Connection info saved to localStorage
5. Redirects to /{channel}/?remote_id=XXX

Return Visit:
1. Portal reads localStorage
2. Automatically reconnects to saved server
3. Redirects to matching frontend channel
```

## Development

```bash
# Install dependencies
npm install

# Run development server
npm run dev

# Build for production
npm run build
```

## Deployment

### Automatic Deployment

The portal is automatically deployed to GitHub Pages when changes are pushed to `main`.

### Frontend Updates

Frontend builds are updated via the `update-frontend.yml` workflow, which can be triggered:

1. **Manually** - Via GitHub Actions workflow dispatch
2. **Automatically** - Via `repository_dispatch` from the server repo's release workflow

## Version Channels

| Channel | Server Version Format | Example |
|---------|----------------------|---------|
| stable  | `X.Y.Z`              | 2.1.0   |
| beta    | `X.Y.ZbN`            | 2.2.0b1 |
| nightly | `X.Y.Z.devN`         | 2.2.0.dev202501271200 |

## Security

The portal uses DTLS certificate pinning for server authentication:

- Remote ID encodes the server's certificate fingerprint
- Certificate is verified before completing the WebRTC handshake
- Prevents man-in-the-middle attacks on the signaling server

## PWA Support

The portal is installable as a PWA. After installation:

- Opens directly to the connection UI
- Remembers last connected server
- Auto-updates when new versions are deployed

## License

Apache License 2.0 - See [LICENSE](LICENSE) for details.
