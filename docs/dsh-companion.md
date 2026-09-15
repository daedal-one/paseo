# DeepSeek Harness companion

This fork adds a DSH provider to Paseo. Run the Paseo daemon on the same Mac as DSH Web, then use **Import session** to connect an existing DSH session. DSH owns its session, workspace, tools, and permission policy. Closing a Paseo session detaches the companion and leaves DSH running.

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

Open <http://localhost:8083>, connect directly to `127.0.0.1:6769`, and choose **Import session**. Search the DSH session titles, select a session, and use the normal chat and approval controls. A failed connection keeps an error visible; refresh the importer after restoring the connection.

The mobile app in this fork includes structured question answers; use it for multi-select choices containing commas. Older clients can answer single-choice and free-text questions, but the DSH provider rejects ambiguous multi-select answers.

## Test on an iPhone

The Mac's companion runs as `local.dsh-companion`, with the built web client enabled and a private Tailscale TCP route from port 6769 to `127.0.0.1:6769`. Connect the iPhone to the same tailnet and open <http://100.110.130.124:6769/> in Safari. Choose **Import session**, select an existing DSH conversation, and send a short message. You can add the page to the Home Screen from Safari's Share menu. Keep the Mac awake.

This route uses Tailscale access controls. The DSH browser credential stays on the Mac. The companion home allows only the configured hostnames and browser origins; keep the listener on loopback. The submitted background job survives terminal exit but needs starting again after logout or reboot. Its log is `/private/tmp/dsh-companion-daemon.log`.

After changing the app, run `npm run build:daemon-web-ui`. After changing the server, run `npm run build:server`. Restart only the companion with `launchctl kickstart -k gui/$(id -u)/local.dsh-companion`. Remove only its route with `TAILSCALE_BE_CLI=1 /Applications/Tailscale.app/Contents/MacOS/Tailscale serve --tcp=6769 off`. DSH's service and routes are separate.

For hosts outside this tailnet, use Paseo's existing [encrypted relay and pairing](../README.md). Enable the relay in the companion home's settings before generating a pairing link with this fork's CLI.

### Native TestFlight build

The `companion` build profile uses **DSH Companion**, bundle ID `com.cavenditti.dshcompanion`, URL scheme `dsh-companion`, Apple team `PN9822BHR7`, and the [cavenditti/dsh-companion Expo project](https://expo.dev/accounts/cavenditti/projects/dsh-companion). Expo manages signing and increments the remote iOS build number. Build and submit with the companion command so the fork uses this app identity:

```sh
npm run companion:testflight
```

This builds on EAS and submits the result to App Store Connect. Use `npm run companion:ios:build` to build separately, then `npm run companion:ios:submit` to submit the latest companion iOS build. EAS needs a distribution certificate, an App Store provisioning profile for this bundle ID, and an App Store Connect app record. The first setup is interactive; Apple sign-in and two-factor authentication happen through Apple's/EAS's login flow. Subsequent releases reuse EAS-managed credentials. Never put passwords, verification codes, or signing keys in this repository.

The [App Store Connect record](https://appstoreconnect.apple.com/apps/6812239241/testflight/ios) is `6812239241`. Its internal group **Team (Expo)** grants access to the Apple account used for signing. After Apple processes the upload, install **DSH Companion** from TestFlight. In the app, choose **Direct connection**, enter `100.110.130.124:6769` with TLS off while Tailscale is connected, then choose **Import session**. The custom URL scheme keeps the fork distinct from Paseo; use direct connection or paste a pairing payload rather than opening a `paseo://` link.

An EAS build completing and an EAS submission succeeding are separate steps. Apple then processes the upload before it becomes installable in TestFlight. Check the exact version and build number on the app's TestFlight page; a successful JavaScript export does not establish native-device behavior. See [Expo's TestFlight guide](https://docs.expo.dev/submit/testflight/) for the current processing steps.

## Ownership and recovery

Approval grants apply once to the requested DSH call. Requests answered or canceled in DSH Web disappear from the companion. Requests for sessions that Paseo has not attached to are delegated to other DSH answerers.

After a connection loss, the provider loads the missing committed history and the current assistant stream. It does not retry a submitted prompt automatically: a lost response may follow an accepted message. Check the transcript before resending when the companion reports uncertain admission.

Change DSH access policy, presets, and host tools in DSH. Paseo's permission modes, injected MCP tools, and custom system prompts are not mapped onto existing DSH sessions. Custom DSH event types remain in DSH's log; this provider projects messages, reasoning, tools, and turn state. Terminal windows, worktrees, and other Paseo host features retain Paseo's own behavior.

## Verification

Focused tests live alongside the adapter in `packages/server/src/server/agent/providers/dsh/`. From `packages/server`:

```sh
npx vitest run src/server/agent/providers/dsh/projection.test.ts src/server/agent/providers/dsh/session.test.ts src/server/agent/providers/dsh/interactions.test.ts src/server/agent/providers/dsh/agent.test.ts --bail=1
npx vitest run src/server/agent/providers/dsh/host.local.e2e.test.ts --bail=1
```

The local integration test requires a built DSH checkout at the sibling `deepseek-harness` directory, or the path supplied in `DSH_REPOSITORY`. It launches real isolated DSH Web processes on OS-assigned loopback ports with recorded model responses. It checks the original session ID, streaming, reload, an approval that writes a temporary file, and a multi-select question with custom text. Background title generation is disabled because it otherwise consumes the conversation's replay responses; telemetry is disabled for these fixtures.

The integration tests are keyless replay evidence. Browser verification covers import and transcript rendering against the running host, including a 390 by 844 viewport. Physical iPhone installation, push notifications, background suspension, relay delivery, and live model quality require separate device verification.
