# Canonical DSH carrier

This iOS Expo module hosts the paired Host’s complete browser interface in WKWebView. The canonical graph owns Session controls, introspection, plugins and the Remote stream multiplexer. Native code owns credentials, authenticated networking and device save/share operations; it never starts the Host.

Before mounting, the carrier verifies the canonical interface marker and injects pinned Host admission. Requests and raw WebSocket connections remain bound to that origin. Bearer credentials stay in native storage, outside renderer JavaScript and URLs. Revocation and view disposal retire the transport. Browser-only Host app launching remains explicitly unavailable to enrolled devices.

Uploads use acknowledged, bounded chunks and native temporary files without an aggregate carrier limit. Cancellation stops staging and removes temporary files. Session ZIP exports await native save/share acceptance. Durable work creation uses Host-scoped SQLite read/compare-exchange operations in the existing creation journal, preserving pending legacy receipts across view replacement.

From the repository root, generate the public bootstrap and native resources with:

```sh
npm run build:client
node scripts/build-dsh-canonical.mjs
```

Then run the app’s `ios` script for the selected app variant. Expo autolinking registers `DshCanonicalModule`; CocoaPods includes its Swift sources, SQLite and generated resource bundle. Generated resources are ignored by Git.

For the generated companion workspace after `pod install`, unsigned compilation from `packages/app/ios` uses:

```sh
xcodebuild -workspace DaedalDSH.xcworkspace -scheme DaedalDSH \
  -configuration Debug -sdk iphonesimulator \
  -destination 'generic/platform=iOS Simulator' \
  CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO CODE_SIGN_IDENTITY='' \
  ARCHS=arm64 ONLY_ACTIVE_ARCH=YES IPHONEOS_DEPLOYMENT_TARGET=15.1 build
```

Qualification separates compilation from execution: the full Expo/CocoaPods app has compiled for an unsigned arm64 iOS Simulator target. A simulator runtime or physical iPhone is still required to qualify enrollment, rendering, cancellation, uploads and share sheets on iOS. No TestFlight or device acceptance is implied by compilation.
