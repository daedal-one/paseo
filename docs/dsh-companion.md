# DeepSeek Harness companion

This fork adds a DSH provider to Paseo. Run the Paseo daemon on the same Mac as DSH Web, then use **Open DSH session** to connect an existing DSH session. DSH owns its session, workspace, tools, and permission policy. Closing a Paseo session detaches the companion and leaves DSH running.

The provider reads paginated history, streams assistant text and reasoning, displays tool calls and results, sends messages, stops turns, answers approvals and questions, and reconnects after a dropped connection. The original DSH session ID is preserved. DSH model and reasoning selections are available in the existing Paseo controls.

## Connect the host

Start from this fork's root with Node and npm installed:

```sh
npm ci
npm run build:server-deps
npm run companion:setup
```

Paste the root login URL printed by the running DSH Web process. The setup command verifies authentication and the model catalog, stores a private browser credential in `.dev/dsh-companion/dsh-auth.json`, and enables DSH in that home's `config.json`. Repeating setup refreshes authentication while preserving the other configuration. Use `-- --home /absolute/path` to select another companion home.

Keep the login URL out of shell arguments and source files. Setup also accepts one URL on standard input. The credential belongs to the exact DSH origin and stays on the Mac; the phone pairs with Paseo. If DSH invalidates the credential, run setup again with a fresh login URL and reload the session.

The generated home disables the other providers, speech, MCP injection, and the relay. It listens on loopback port 6769. DSH's existing listener and Tailscale routes remain independently managed.

## Run the fork

In one terminal:

```sh
export PASEO_HOME="$PWD/.dev/dsh-companion"
export PASEO_CORS_ORIGINS="http://localhost:8083"
node --import tsx packages/server/scripts/supervisor-entrypoint.ts --dev
```

In another terminal, from the same repository root:

```sh
npm run build:app-deps
export PASEO_HOME="$PWD/.dev/dsh-companion"
PASEO_LISTEN=127.0.0.1:6769 EXPO_PORT=8083 ./scripts/dev-app.sh
```

Open <http://localhost:8083>, connect directly to `127.0.0.1:6769`, and choose **Open DSH session**. Search the DSH session titles, select a session, and use the normal chat and approval controls. A failed connection keeps an error visible; refresh the importer after restoring the connection.

The desktop and mobile app preserve selected options and custom text together for DSH multi-select questions, including commas within labels or custom text. Older clients can answer single-choice and free-text questions, but the DSH provider rejects ambiguous multi-select answers.

## Desktop preview

Directory-only desktop previews are updated manually. **About** shows when automatic updates are unavailable and disables update installation; release builds retain the fork-owned update feed.

**Help** opens the fork’s DSH setup guide. **Report an issue** opens the daedal-one tracker. Feature guides remain in the fork while the bridge is available.

Daedal DSH desktop connects to the existing companion at `127.0.0.1:6769`. The preview uses the current DSH bridge; native DSH client integration remains a separate migration task. Keep the companion host running before opening the desktop app.

The shell does not start, stop, restart or upgrade a local Paseo daemon, and closing it leaves the external DSH host running. If the companion is unavailable, the app does not fall back to an unrelated daemon on port 6767. Use **Connect DSH host** on the home screen to open pairing and Tailscale discovery. Saved remote hosts can still be selected in the app.

The desktop product uses daedal-one assets and the fork-owned GitHub update destination. A local ad-hoc-signed preview is not a notarized release or proof of TestFlight behavior. Directory-only packages have no update manifest; automatic-update qualification requires a release artifact. The installed iPhone app retains its bundle identifier and Expo project.

## Test on an iPhone

### Pair once, discover other hosts

With Tailscale connected on the Mac and iPhone, run `npm run companion:pair` on the Mac. Open the generated `.dev/companion-pair.png`, then choose **Scan QR code** in Daedal DSH. Confirm the host name and connect. The matching `.txt` file can also be pasted into **Paste pairing link**. The QR contains a private address and expected host identity; a host password, if configured, is entered separately on the phone.

After pairing, **Settings → Add host** searches automatically through connected hosts that support discovery. Tap a discovered name to connect. The phone verifies both reachability and host identity before saving it. Existing saved hosts remain available when discovery cannot run. At least one paired host must be online to search; the phone does not need a Tailscale admin credential.

Every discoverable machine must run this fork's companion with DSH enabled and authenticated. Keep its listener on `127.0.0.1:6769`, allow its own Tailscale IPv4 address in `daemon.hostnames` in the companion home's `config.json`, and expose only companion port 6769 with Tailscale TCP Serve. On macOS:

```sh
TAILSCALE_BE_CLI=1 /Applications/Tailscale.app/Contents/MacOS/Tailscale serve --bg --tcp=6769 tcp://127.0.0.1:6769
```

On Linux, use `tailscale` from PATH. Restart only the companion after configuration changes. A bare DSH Web process, a companion on a different port, an offline host, or a host hidden by Tailscale access rules will not appear. Run `companion:pair` again after replacing a host's identity.

Discovery reads `tailscale status --json` on a paired host and checks only canonical Tailscale IPv4 addresses listed there. It never scans the address range or forwards credentials to peers. Searches share a 15-second cache, check at most 256 addresses with eight concurrent requests, and stop after an eight-second probe budget. Partial results are labeled. Search authority requires `tunnel.manage`; each selected connection remains subject to the phone's own Tailscale access rules and the target host's password.

The public `/.well-known/dsh-companion` response contains only the service version, host name, server ID, and whether a password is required. Host validation still applies, and the endpoint advertises only while the authenticated local DSH catalog is reachable. Existing API and WebSocket authentication remains in place. This discovery endpoint is separate from the DSH listener.

### Browser access

The Mac's companion runs as `local.dsh-companion`, with the built web client enabled and a private Tailscale TCP route from port 6769 to `127.0.0.1:6769`. Connect the iPhone to the same tailnet and open <http://100.110.130.124:6769/> in Safari. Choose **Open DSH session**, select an existing DSH conversation, and send a short message. You can add the page to the Home Screen from Safari's Share menu. Keep the Mac awake.

This route uses Tailscale access controls. The DSH browser credential stays on the Mac. The companion home allows only the configured hostnames and browser origins; keep the listener on loopback. The submitted background job survives terminal exit but needs starting again after logout or reboot. Its log is `/private/tmp/dsh-companion-daemon.log`.

After changing the app, run `npm run build:daemon-web-ui`. After changing the server, run `npm run build:server`. Restart only the companion with `launchctl kickstart -k gui/$(id -u)/local.dsh-companion`. Remove only its route with `TAILSCALE_BE_CLI=1 /Applications/Tailscale.app/Contents/MacOS/Tailscale serve --tcp=6769 off`. DSH's service and routes are separate.

For hosts outside this tailnet, use Paseo's existing [encrypted relay and pairing](../README.md). Enable the relay in the companion home's settings before generating a pairing link with this fork's CLI.

### Preview 0.8.0

TestFlight build **7003003** is available to the existing **Team (Expo)** internal tester group. It updates the installed companion to **Daedal DSH** and retains its application identity. Open TestFlight, select the companion app, and choose **Update**. Keep Tailscale connected and the Mac awake; existing saved companion connections remain usable.

Open an existing DSH session, send a short message, answer an approval or question, and reconnect after changing networks. The default conversation screens use the existing companion bridge. **Settings → DSH hosts** is a separate opt-in native preview requiring a compatible enrolled host; long-plan scrolling, text-composer keyboard behavior and physical-device qualification remain in progress. The current DSH interface remains available throughout migration.

The macOS app is a local ad-hoc-signed preview with manual updates. Its earlier working copy is retained for recovery. This release does not install or manage the DSH host; start the existing companion before opening the desktop app.

### Native TestFlight build

The `companion` build profile uses **Daedal DSH**, bundle ID `com.cavenditti.dshcompanion`, URL scheme `dsh-companion`, Apple team `PN9822BHR7`, and the [cavenditti/dsh-companion Expo project](https://expo.dev/accounts/cavenditti/projects/dsh-companion). Expo manages signing and increments the remote iOS build number. Build and submit with the companion command so the fork uses this app identity:

```sh
npm run companion:testflight
```

This builds on EAS and submits the result to App Store Connect. Use `npm run companion:ios:build` to build separately, then `npm run companion:ios:submit` to submit the latest companion iOS build. EAS needs a distribution certificate, an App Store provisioning profile for this bundle ID, and an App Store Connect app record. The first setup is interactive; Apple sign-in and two-factor authentication happen through Apple's/EAS's login flow. Subsequent releases reuse EAS-managed credentials. Never put passwords, verification codes, or signing keys in this repository.

The [App Store Connect record](https://appstoreconnect.apple.com/apps/6812239241/testflight/ios) is `6812239241`. Its internal group **Team (Expo)** grants access to the Apple account used for signing. After Apple processes the upload, install **Daedal DSH** from TestFlight, pair using the QR above, and choose **Open DSH session**. The custom URL scheme keeps the fork distinct from Paseo. Direct connection remains available for hosts outside the discovery setup.

An EAS build completing and an EAS submission succeeding are separate steps. Apple then processes the upload before it becomes installable in TestFlight. Check the exact version and build number on the app's TestFlight page; a successful JavaScript export does not establish native-device behavior. See [Expo's TestFlight guide](https://docs.expo.dev/submit/testflight/) for the current processing steps.

## Ownership and recovery

Approval grants apply once to the requested DSH call. Requests answered or canceled in DSH Web disappear from the companion. Requests for sessions that Paseo has not attached to are delegated to other DSH answerers.

After a connection loss, the provider loads the missing committed history and the current assistant stream. It does not retry a submitted prompt automatically: a lost response may follow an accepted message. Check the transcript before resending when the companion reports uncertain admission.

Change DSH access policy, presets, and host tools in DSH. Paseo's permission modes, injected MCP tools, and custom system prompts are not mapped onto existing DSH sessions. Custom DSH event types remain in DSH's log; this provider projects messages, reasoning, tools, and turn state. Terminal windows, worktrees, and other Paseo host features retain Paseo's own behavior.

## Native frontend development

The main conversation screens use the companion bridge described above; iPhone Settings → DSH hosts offers a native Session preview. That runtime lives in `packages/app/src/dsh/` and consumes the [generated DSH Client artifacts](../vendor/dsh/README.md). `native/access.ts` enrolls a selected Host once and opens saved access with the existing DSH Session and Workspace services. Its caller owns one runtime per Host, hydrated navigation, visible connection state and disposal before local forgetting.

`native/device-store.ts` keeps device grants and selected origins in Expo SecureStore with device-only, unlocked keychain access. Ordinary storage contains only the Host-id index. A missing keychain value is unpaired; corrupt or unavailable storage fails explicitly. An interrupted save or forget can leave an unpaired index entry. Local forgetting deletes the device secret but does not revoke its Host-side grant. Pairing consumes its challenge once; a lost response is uncertain and is not retried. A storage failure after a successful claim requires owner-side grant recovery before pairing again.

The iOS transport uses Expo Fetch with cookie omission and redirect refusal, plus React Native WebSocket with a bearer header and the selected Origin. The adapter reads and cancels the native response stream itself because SDK 54 text/JSON decoding can remain pending after cancellation. Every carrier is pinned to the complete saved origin. HTTP is allowed only for explicit loopback or numeric Tailscale addresses; other origins require HTTPS. iOS may supply ambient WebSocket cookies, so DSH's strict bearer rejection remains required. Android, browser and Electron transports have separate qualification gates. Credentials never travel in URLs or diagnostic messages.

Run the focused access tests from the root with `npm run test --workspace=@getpaseo/app -- src/dsh/native/access.test.ts`. They use native-module substitutes and the real installed DSH runtime. They do not establish camera pairing, application navigation, physical-iPhone behavior or TestFlight acceptance. The [migration plan](daedal-dsh-migration-plan.md) owns those remaining gates.

### Native interaction requests

The native Host runtime uses DSH's shared pending registry and Remote approval/question consumers. Each Session row identifies waiting requests; the conversation composer displays the effective request. Tool approvals allow once or reject. Questions retain verbatim choices, free text, explicit skips and complete-batch submission; plan reviews show their full detail. A higher-priority request preserves the hidden form's draft. Leaving a conversation retains Host-owned work; leaving the directory releases its interaction consumers.

Responses settle the shared Client carrier once. They are not replayed after disconnection, and local submission does not establish Host acceptance: follow the authoritative conversation and connection state. Native rendering, actual authenticated interaction delivery and physical-device release qualification remain separate from controlled transport tests.

### Host directory preview

On iPhone, Settings → DSH hosts opens the native access preview. Scan a version-1 JSON device-enrollment QR, confirm the displayed origin and Host identity, and save the grant before viewing its Session list. Repeated camera frames do not claim access. QR challenges stay in memory; credentials remain in protected storage. The native device-enrollment QR is distinct from the legacy companion pairing link. Request enrollment from the owner-facing device access settings in DSH.

The directory opens one generated DSH runtime at a time. Switching Hosts, forgetting local access and leaving the screen release its connection without stopping Sessions. Loading, missing or corrupt grants, unreachable Hosts and empty Session lists have separate states. Session rows display Host titles and running state. Read conversation opens the loaded history window through the installed DSH Conversation and Chat engine, including text, reasoning and basic tool output. Back returns to the list; selecting another Session replaces the visible binding. React reads and subscribes through that Session instance; subscription callbacks retain their receiver and detach with the view. Failed initial history reads offer a retry, and disconnected views retain received content. The text composer stays below the scrolling history and uses the application keyboard dock and viewport bound. Its draft and status area can scroll while Send stays outside that area. The text composer queues one message through the selected Session. It waits for Host-confirmed acceptance before clearing the submitted draft, preserves text entered during submission, and prevents duplicate taps. Known pre-admission refusals preserve a retryable draft. Lost, cancelled or unclassified replies keep an unknown outcome visible and cannot be resent from that form; reconnect does not submit again. Leaving the view aborts only its pending request. Native approval, question-batch and plan-review controls use the shared pending-interaction registry. Synthetic authenticated Simulator requests qualify delivery and cancellation; long-detail scrolling and physical-device behavior remain open. Earlier history, rich or deferred content, attachments and remembered Session navigation remain migration work; use the current DSH interface for those operations. Reconnect, refresh and pagination use DSH services directly. Failed reads remain visible and retryable; retained rows do not imply that a refresh succeeded. Other platform builds show an availability message and do not load the iOS access implementation. Preview text uses typed locale dictionaries with an English fallback.

## Verification

Focused tests live alongside the adapter in `packages/server/src/server/agent/providers/dsh/`. From `packages/server`:

```sh
npx vitest run src/server/agent/providers/dsh/projection.test.ts src/server/agent/providers/dsh/session.test.ts src/server/agent/providers/dsh/interactions.test.ts src/server/agent/providers/dsh/agent.test.ts --bail=1
npx vitest run src/server/agent/providers/dsh/host.local.e2e.test.ts --bail=1
npx vitest run src/server/companion-discovery.test.ts src/server/session/daemon/daemon-session.test.ts --bail=1
```

The local integration test requires a built DSH checkout at the sibling `deepseek-harness` directory, or the path supplied in `DSH_REPOSITORY`. It launches real isolated DSH Web processes on OS-assigned loopback ports with recorded model responses. It checks the original session ID, streaming, reload, an approval that writes a temporary file, and a multi-select question with custom text. Background title generation is disabled because it otherwise consumes the conversation's replay responses; telemetry is disabled for these fixtures.

Pairing validation also lives in `packages/protocol/src/companion-discovery.test.ts` and `packages/app/src/utils/companion-pairing.test.ts`. These cover invalid addresses, identity mismatches, cancellation with React Native's AbortController, and saving only verified connections. Run each from its package directory with `npx vitest run <path> --bail=1`.

The integration tests are keyless replay evidence. Browser verification covers pairing from the generated payload, automatic discovery after reopening Settings, import, and transcript rendering against the running host at a 390 by 844 viewport. The live tailnet check has one DSH companion; multiple-host behavior is covered by the discovery tests. Physical iPhone camera scanning, push notifications, background suspension, relay delivery, and live model quality require separate device verification.
