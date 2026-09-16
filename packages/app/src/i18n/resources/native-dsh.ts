export const nativeDsh = {
  title: "DSH hosts",
  iosOnly:
    "Native host access is available on iPhone. Desktop and browser access are being migrated.",
  preview:
    "Native DSH preview · Pair a host and view its sessions. Conversation controls are being integrated.",
  scan: "Scan pairing QR",
  scanAgain: "Scan a new QR",
  scanHint:
    "Scan a device enrollment QR from your DSH host. Keep Tailscale connected on both devices.",
  cameraPermission: "Allow camera access",
  cameraFailed: "The camera is unavailable. Check camera access in Settings and try again.",
  pairing: "Pairing and protecting device access…",
  confirmPairing: "Pair with this host?",
  identity: "Host identity: {{id}}",
  pairingTrust: "Continue only if this is the host whose enrollment QR you requested.",
  pair: "Pair host",
  deviceLabel: "Daedal DSH iPhone",
  forget: "Forget on this iPhone",
  forgetHint:
    "This removes access from this iPhone and closes its connection. Sessions keep running. To revoke the device grant, remove it on the DSH host.",
  connect: "View sessions",
  sessions: "Sessions",
  waiting: "Waiting for a live host response. Check Tailscale and that your host is awake.",
  emptySessions: "This host has no sessions.",
  running: "Running",
  idle: "Idle",
  reconnect: "Reconnect",
  refresh: "Refresh sessions",
  loadMore: "Load more",
  emptyHosts: "No native DSH hosts paired yet.",
  reload: "Reload saved hosts",
  connection: {
    connected: "Connected",
    connecting: "Connecting…",
    disconnected: "Disconnected · reconnecting",
  },
  errors: {
    "runtime-unavailable":
      "Could not open or close the host connection. Close and reopen the app before trying again.",
    "session-refresh-failed": "Could not refresh sessions. Reconnect and try again.",
    "invalid-origin": "This QR uses an unsupported host address. Request a new QR from the host.",
    "invalid-record":
      "Saved access could not be read. Forget this host on the phone and pair again.",
    "storage-unavailable": "Protected storage is unavailable. Unlock your iPhone and retry.",
    "not-paired":
      "This host has no saved device access. Review enrolled devices on the host before requesting a new QR.",
    "already-paired": "This host is already paired. Open it from the saved hosts.",
    "unsupported-platform": "Native host access is not available on this platform yet.",
    "transport-disposed": "The host connection has closed. Reconnect to continue.",
    "request-cancelled": "The request was cancelled.",
    "transport-failed": "Could not reach the host. Check Tailscale and try again.",
    "invalid-response": "The host returned an unreadable response. Check its version.",
    "invalid-enrollment":
      "This is not a native DSH device enrollment QR. Request a new one from the host.",
    "expired-enrollment": "This enrollment QR has expired. Request a new one from the host.",
    "enrollment-rejected": "The host rejected enrollment. Request a new QR and try again.",
    "enrollment-outcome-unknown":
      "The pairing result is unknown. Inspect enrolled devices on the host and revoke any unused grant before requesting a new QR. This claim will not be retried.",
    "enrollment-save-failed":
      "The host granted access, but this iPhone could not save it. Revoke that device on the host, then request a new enrollment QR.",
  },
} as const;
