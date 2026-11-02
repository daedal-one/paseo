import ExpoModulesCore
import WebKit
import Security

public final class DshCanonicalModule: Module {
  public func definition() -> ModuleDefinition {
    Name("DshCanonical")
    View(DshCanonicalView.self) {
      Events("onCarrierError")
      Prop("hostId") { (view: DshCanonicalView, hostId: String) in view.setHost(hostId) }
    }
  }
}

private enum CarrierFailure: Error { case refused, unavailable }

private struct SavedHost {
  let origin: URL
  let credential: String
  static func load(_ id: String) throws -> SavedHost {
    guard UUID(uuidString: id) != nil else { throw CarrierFailure.refused }
    let key = Data("daedal.dsh.host.\(id)".utf8)
    var item: CFTypeRef?
    let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: "daedal.dsh.device-access.v1:no-auth",
      kSecAttrGeneric as String: key, kSecAttrAccount as String: key,
      kSecReturnData as String: true, kSecMatchLimit as String: kSecMatchLimitOne]
    guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess,
      let data = item as? Data,
      let record = try JSONSerialization.jsonObject(with: data) as? [String: Any],
      record["version"] as? Int == 1,
      let originText = record["origin"] as? String,
      let origin = URL(string: originText), origin.user == nil, origin.password == nil,
      origin.query == nil, origin.fragment == nil, origin.path.isEmpty || origin.path == "/",
      let hostname = origin.host,
      let grant = record["grant"] as? [String: Any], grant["hostId"] as? String == id,
      let credential = grant["credential"] as? String, !credential.isEmpty
    else { throw CarrierFailure.refused }
    let octets = hostname.split(separator: ".").compactMap { Int($0) }
    let tailscale = octets.count == 4 && octets[0] == 100 && (64...127).contains(octets[1]) && octets.allSatisfy { (0...255).contains($0) }
    let local = ["localhost", "127.0.0.1", "::1", "[::1]"].contains(hostname)
    guard origin.scheme == "https" || (origin.scheme == "http" && (local || tailscale || hostname.hasPrefix("[fd7a:115c:a1e0:") || hostname.hasPrefix("fd7a:115c:a1e0:"))) else { throw CarrierFailure.refused }
    return SavedHost(origin: origin, credential: credential)
  }
}

private final class NativeBodyStage {
  let directory: URL
  let file: URL
  private var handle: FileHandle?
  private var sequence = 0
  private var sealed = false
  init() throws {
    directory = FileManager.default.temporaryDirectory.appendingPathComponent("dsh-body-" + UUID().uuidString)
    file = directory.appendingPathComponent("body")
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
    guard FileManager.default.createFile(atPath: file.path, contents: nil, attributes: [.posixPermissions: 0o600]) else {
      try? FileManager.default.removeItem(at: directory); throw CarrierFailure.unavailable
    }
    do { handle = try FileHandle(forWritingTo: file) }
    catch { try? FileManager.default.removeItem(at: directory); throw error }
  }
  func write(_ index: Int, _ encoded: String) throws {
    guard index == sequence, !sealed, let handle, encoded.utf8.count <= ((256 * 1024 + 2) / 3) * 4,
      let bytes = Data(base64Encoded: encoded), bytes.count <= 256 * 1024,
      bytes.base64EncodedString() == encoded else { throw CarrierFailure.refused }
    try handle.write(contentsOf: bytes)
    sequence += 1
  }
  func seal() throws {
    guard !sealed, let handle else { throw CarrierFailure.refused }
    try handle.close(); self.handle = nil; sealed = true
  }
  func requireSealed() throws { guard sealed else { throw CarrierFailure.refused } }
  func dispose() { try? handle?.close(); handle = nil; try? FileManager.default.removeItem(at: directory) }
}

/** View state is main-queue confined, including URLSession delegates and storage replies. Keychain bytes never enter WK JavaScript. */
final class DshCanonicalView: ExpoView, WKURLSchemeHandler, WKScriptMessageHandlerWithReply, WKNavigationDelegate, WKUIDelegate, URLSessionWebSocketDelegate, @unchecked Sendable {
  let onCarrierError = EventDispatcher()
  private var selectedHost: String?
  private var host: SavedHost?
  private var webView: WKWebView?
  private var network: URLSession?
  private var requests: [String: URLSessionDataTask] = [:]
  private var stages: [String: NativeBodyStage] = [:]
  private var schemeRequests: [ObjectIdentifier: URLSessionDataTask] = [:]
  private var sockets: [String: URLSessionWebSocketTask] = [:]
  private var epoch = 0
  private var exportFiles = Set<URL>()
  private var shareController: UIActivityViewController?
  private var shareRequestId: String?
  private var shareReply: ((Any?, String?) -> Void)?
  private let creationQueue = DispatchQueue(label: "daedal.dsh.creation-storage")

  func setHost(_ id: String) {
    if selectedHost == id { return }
    stop()
    selectedHost = id
    if window != nil { start() }
  }
  override func didMoveToWindow() {
    super.didMoveToWindow()
    if window == nil { stop() } else if webView == nil { start() }
  }
  override func layoutSubviews() { super.layoutSubviews(); webView?.frame = bounds }
  private func resource(_ name: String, _ ext: String) throws -> Data {
    let base = Bundle(for: DshCanonicalModule.self)
    guard let url = base.url(forResource: "DshCanonical", withExtension: "bundle"),
      let bundle = Bundle(url: url), let file = bundle.url(forResource: name, withExtension: ext)
    else { throw CarrierFailure.unavailable }
    return try Data(contentsOf: file)
  }
  private func start() {
    guard let id = selectedHost, webView == nil else { return }
    do {
      let saved = try SavedHost.load(id)
      let bootstrap = String(decoding: try resource("bootstrap", "js"), as: UTF8.self)
      let admission: [String: Any] = ["expectedHostId": id, "requiredCapabilities": try JSONSerialization.jsonObject(with: resource("admission", "json"))]
      let admissionText = String(decoding: try JSONSerialization.data(withJSONObject: admission), as: UTF8.self)
      let config = WKWebViewConfiguration()
      config.websiteDataStore = .nonPersistent()
      config.setURLSchemeHandler(self, forURLScheme: "dshremote")
      config.userContentController.addScriptMessageHandler(self, contentWorld: .page, name: "dsh")
      config.userContentController.addUserScript(WKUserScript(source: "globalThis.__DSH_REMOTE_ADMISSION__=\(admissionText);\n\(bootstrap)", injectionTime: .atDocumentStart, forMainFrameOnly: true))
      let view = WKWebView(frame: bounds, configuration: config)
      view.navigationDelegate = self
      view.uiDelegate = self
      view.isOpaque = false
      view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
      host = saved
      let networkConfig = URLSessionConfiguration.ephemeral
      networkConfig.httpCookieStorage = nil
      networkConfig.httpShouldSetCookies = false
      networkConfig.urlCache = nil
      network = URLSession(configuration: networkConfig, delegate: self, delegateQueue: .main)
      webView = view
      addSubview(view)
      view.load(URLRequest(url: URL(string: "dshremote://host/index.html")!))
    } catch { stop(); onCarrierError(["code": "canonical-unavailable"]) }
  }
  private func stop() {
    epoch += 1
    network?.invalidateAndCancel()
    network = nil
    for request in requests.values { request.cancel() }
    for request in schemeRequests.values { request.cancel() }
    for socket in sockets.values { socket.cancel(with: .goingAway, reason: nil) }
    requests.removeAll(); schemeRequests.removeAll(); sockets.removeAll()
    for stage in stages.values { stage.dispose() }; stages.removeAll()
    webView?.stopLoading()
    webView?.configuration.userContentController.removeScriptMessageHandler(forName: "dsh", contentWorld: .page)
    webView?.navigationDelegate = nil
    webView?.uiDelegate = nil
    webView?.removeFromSuperview()
    webView = nil; host = nil
    shareController?.dismiss(animated: false); shareController = nil
    shareReply?(nil, "Export cancelled"); shareReply = nil; shareRequestId = nil
    for file in exportFiles { try? FileManager.default.removeItem(at: file) }
    exportFiles.removeAll()
  }
  private func allowed(_ path: String, _ method: String) -> Bool {
    guard !path.unicodeScalars.contains(where: { $0.value <= 32 || $0.value == 127 }), path.hasPrefix("/"), !path.hasPrefix("//"), !path.contains("\\"), !path.contains("#"),
      let decoded = path.components(separatedBy: "?").first?.removingPercentEncoding,
      !decoded.contains("\\"), !decoded.contains("\0"), !decoded.contains("%"), !decoded.split(separator: "/").contains(where: { $0 == "." || $0 == ".." }),
      let components = URLComponents(string: "https://host.invalid" + path), components.scheme == "https", components.host == "host.invalid", components.port == nil, components.user == nil, components.password == nil else { return false }
    if components.path.hasPrefix("/api/") {
      if components.path == "/api/session.export" {
        let entries = components.queryItems ?? []
        return ["GET", "HEAD"].contains(method) && (1...2).contains(entries.count) &&
          entries.filter { $0.name == "sessionId" && !($0.value ?? "").isEmpty }.count == 1 &&
          entries.allSatisfy { $0.name == "sessionId" || ($0.name == "includeDescendants" && ["true", "false"].contains($0.value ?? "")) }
      }
      if components.path == "/api/session/uploadFileBinary" {
        let entries = components.queryItems ?? []
        return method == "POST" && (1...2).contains(entries.count) &&
          entries.filter { $0.name == "sessionId" && !($0.value ?? "").isEmpty }.count == 1 &&
          entries.allSatisfy { $0.name == "sessionId" || $0.name == "name" }
      }
      return method == "POST" && components.query == nil &&
        (components.path.range(of: "^/api/[A-Za-z0-9_$.-]+/[A-Za-z0-9_$.-]+$", options: .regularExpression) != nil || ["/api/$capabilities", "/api/pdf-assets"].contains(components.path))
    }
    guard ["GET", "HEAD"].contains(method) else { return false }
    return ["/", "/index.html"].contains(components.path) || components.path.hasPrefix("/plugins/") || components.path.hasPrefix("/assets/") ||
      components.path.range(of: "^/[A-Za-z0-9_.-]+\\.(ico|png|svg|woff2?|webmanifest)$", options: .regularExpression) != nil
  }
  private func request(_ path: String, _ method: String, _ headers: [String: String], _ body: Data?) throws -> URLRequest {
    guard let host, allowed(path, method), let target = URL(string: path, relativeTo: host.origin)?.absoluteURL, target.scheme == host.origin.scheme, target.host == host.origin.host, target.port == host.origin.port, target.user == nil, target.password == nil else { throw CarrierFailure.refused }
    var request = URLRequest(url: target)
    request.httpMethod = method; request.httpBody = body
    request.setValue("Bearer \(host.credential)", forHTTPHeaderField: "Authorization")
    request.setValue(host.origin.absoluteString, forHTTPHeaderField: "Origin")
    for (key, value) in headers where ["content-type", "accept", "range"].contains(key.lowercased()) { request.setValue(value, forHTTPHeaderField: key) }
    return request
  }
  func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
    let current = epoch
    let identity = ObjectIdentifier(urlSchemeTask)
    do {
      guard let url = urlSchemeTask.request.url, url.scheme == "dshremote", url.host == "host", let network else { throw CarrierFailure.refused }
      let path = url.path + (url.query.map { "?" + $0 } ?? "")
      let outgoing = try request(path, urlSchemeTask.request.httpMethod ?? "GET", [:], nil)
      let task = network.dataTask(with: outgoing) { [weak self] data, response, error in
        guard let self, current == self.epoch, self.schemeRequests.removeValue(forKey: identity) != nil else { return }
        guard error == nil, let response = response as? HTTPURLResponse, let data else { urlSchemeTask.didFailWithError(CarrierFailure.unavailable); return }
        if response.statusCode == 401 || response.statusCode == 403 { urlSchemeTask.didFailWithError(CarrierFailure.refused); self.stop(); self.onCarrierError(["code": "access-refused"]); return }
        if ["/", "/index.html"].contains(url.path), response.statusCode == 200,
          !String(decoding: data, as: UTF8.self).contains("<meta name=\"dsh-canonical-interface\" content=\"1\">") {
          urlSchemeTask.didFailWithError(CarrierFailure.unavailable); self.stop(); self.onCarrierError(["code": "canonical-unavailable"]); return
        }
        let headers = ["Content-Type": response.value(forHTTPHeaderField: "Content-Type") ?? "application/octet-stream", "Cache-Control": "no-store"]
        guard let local = HTTPURLResponse(url: url, statusCode: response.statusCode, httpVersion: "HTTP/1.1", headerFields: headers) else { urlSchemeTask.didFailWithError(CarrierFailure.unavailable); return }
        urlSchemeTask.didReceive(local); urlSchemeTask.didReceive(data); urlSchemeTask.didFinish()
      }
      schemeRequests[identity] = task
      task.resume()
    } catch { urlSchemeTask.didFailWithError(CarrierFailure.refused) }
  }
  func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) { schemeRequests.removeValue(forKey: ObjectIdentifier(urlSchemeTask))?.cancel() }
  func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
    if action.targetFrame?.isMainFrame == false, let url = action.request.url,
      url.scheme == "blob" || url.scheme == "data" || url.absoluteString == "about:blank" {
      decisionHandler(.allow); return
    }
    if action.sourceFrame.isMainFrame, let url = action.request.url, ["https", "http"].contains(url.scheme ?? "") {
      openExternal(url); decisionHandler(.cancel); return
    }
    guard action.targetFrame?.isMainFrame == true, let url = action.request.url,
      url.scheme == "dshremote", url.host == "host", ["/", "/index.html"].contains(url.path), url.query == nil else { decisionHandler(.cancel); return }
    decisionHandler(.allow)
  }
  private func openExternal(_ url: URL) {
    guard ["https", "http"].contains(url.scheme ?? ""), url.user == nil, url.password == nil else { return }
    UIApplication.shared.open(url)
  }
  func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
    if action.sourceFrame.isMainFrame, let url = action.request.url { openExternal(url) }
    return nil
  }
  func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) { completionHandler(nil) }
  func urlSession(_ session: URLSession, webSocketTask: URLSessionWebSocketTask, didOpenWithProtocol protocol: String?) {
    guard let id = sockets.first(where: { $0.value === webSocketTask })?.key else { return }
    emit(id, "open")
    receive(id, webSocketTask, epoch)
  }
  func urlSession(_ session: URLSession, webSocketTask: URLSessionWebSocketTask, didCloseWith closeCode: URLSessionWebSocketTask.CloseCode, reason: Data?) {
    guard let id = sockets.first(where: { $0.value === webSocketTask })?.key else { return }
    sockets.removeValue(forKey: id); emit(id, "close")
  }
  func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
    guard let socket = task as? URLSessionWebSocketTask,
      let id = sockets.first(where: { $0.value === socket })?.key else { return }
    sockets.removeValue(forKey: id)
    if error != nil { emit(id, "error") }
    emit(id, "close")
    if let status = (task.response as? HTTPURLResponse)?.statusCode, status == 401 || status == 403 {
      stop(); onCarrierError(["code": "access-refused"])
    }
  }
  private func emit(_ id: String, _ type: String, _ data: String? = nil) {
    var event: [String: Any] = ["id": id, "type": type]
    if let data { event["data"] = data }
    guard let encoded = try? JSONSerialization.data(withJSONObject: event) else { return }
    let json = String(decoding: encoded, as: UTF8.self)
    webView?.evaluateJavaScript("dispatchEvent(new CustomEvent('dsh-native-socket',{detail:\(json)}))", completionHandler: nil)
  }
  private func receive(_ id: String, _ socket: URLSessionWebSocketTask, _ current: Int) {
    socket.receive { [weak self] result in
      DispatchQueue.main.async {
        guard let self, self.epoch == current, self.sockets[id] === socket else { return }
        switch result {
        case .success(let message):
          switch message { case .string(let value): self.emit(id, "message", value)
          case .data(let value): self.emit(id, "message", String(decoding: value, as: UTF8.self))
          @unknown default: self.emit(id, "error") }
          self.receive(id, socket, current)
        case .failure: self.sockets.removeValue(forKey: id); self.emit(id, "error"); self.emit(id, "close")
        }
      }
    }
  }
  func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage, replyHandler: @escaping (Any?, String?) -> Void) {
    guard message.frameInfo.isMainFrame, message.frameInfo.securityOrigin.protocol == "dshremote", message.frameInfo.securityOrigin.host == "host",
      let value = message.body as? [String: Any], let kind = value["kind"] as? String,
      let id = value["id"] as? String, UUID(uuidString: id) != nil, let network, let host else { replyHandler(nil, "Carrier refused"); return }
    let fields: [String: Set<String>] = [
      "fetch": ["kind", "id", "path", "method", "headers", "bodyStageId"],
      "creation-read": ["kind", "id"], "creation-cas": ["kind", "id", "before", "after"],
      "body-open": ["kind", "id"], "body-write": ["kind", "id", "sequence", "data"],
      "body-seal": ["kind", "id"], "body-discard": ["kind", "id"],
      "download": ["kind", "id", "path", "filename"],
      "abort": ["kind", "id"], "socket-open": ["kind", "id"],
      "socket-close": ["kind", "id"], "socket-send": ["kind", "id", "data"]]
    guard fields[kind] == Set(value.keys) else { replyHandler(nil, "Carrier refused"); return }
    do {
      switch kind {
      case "creation-read", "creation-cas":
        guard let hostId = selectedHost, let documents = appContext?.config.documentDirectory else { throw CarrierFailure.unavailable }
        let storage = try CanonicalCreationStorage(documents: documents)
        let before = kind == "creation-cas" ? try CanonicalCreationStorage.validate(value["before"]) : nil
        let after = kind == "creation-cas" ? try CanonicalCreationStorage.validate(value["after"]) : nil
        let current = epoch
        creationQueue.async { [weak self] in
          let result: Result<Any, Error> = Result {
            if kind == "creation-read" { return try storage.read(hostId: hostId) as Any? ?? NSNull() }
            return try storage.compareExchange(hostId: hostId, before: before, after: after)
          }
          DispatchQueue.main.async {
            guard let self, self.epoch == current else { replyHandler(nil, "Carrier stopped"); return }
            switch result {
            case .success(let value): replyHandler(value, nil)
            case .failure: replyHandler(nil, "Creation storage unavailable")
            }
          }
        }
      case "body-open":
        guard stages[id] == nil else { throw CarrierFailure.refused }
        stages[id] = try NativeBodyStage(); replyHandler(NSNull(), nil)
      case "body-write":
        guard let stage = stages[id], let sequence = value["sequence"] as? Int,
          sequence >= 0, let data = value["data"] as? String else { throw CarrierFailure.refused }
        try stage.write(sequence, data); replyHandler(NSNull(), nil)
      case "body-seal":
        guard let stage = stages[id] else { throw CarrierFailure.refused }
        try stage.seal(); replyHandler(NSNull(), nil)
      case "body-discard": stages.removeValue(forKey: id)?.dispose(); replyHandler(NSNull(), nil)
      case "abort":
        requests.removeValue(forKey: id)?.cancel()
        if shareRequestId == id {
          shareController?.dismiss(animated: true); shareController = nil
          shareReply?(nil, "Export cancelled"); shareReply = nil; shareRequestId = nil
          for file in exportFiles { try? FileManager.default.removeItem(at: file) }; exportFiles.removeAll()
        }
        replyHandler(NSNull(), nil)
      case "socket-close": sockets.removeValue(forKey: id)?.cancel(with: .normalClosure, reason: nil); emit(id, "close"); replyHandler(NSNull(), nil)
      case "socket-send":
        guard let socket = sockets[id], let data = value["data"] as? String else { throw CarrierFailure.refused }
        socket.send(.string(data)) { error in replyHandler(error == nil ? NSNull() : nil, error == nil ? nil : "Socket failed") }
      case "socket-open":
        guard sockets[id] == nil, var url = URLComponents(url: host.origin, resolvingAgainstBaseURL: false) else { throw CarrierFailure.refused }
        url.scheme = host.origin.scheme == "https" ? "wss" : "ws"; url.path = "/api/remote.mux"
        guard let target = url.url else { throw CarrierFailure.refused }
        var request = URLRequest(url: target)
        request.setValue("Bearer \(host.credential)", forHTTPHeaderField: "Authorization"); request.setValue(host.origin.absoluteString, forHTTPHeaderField: "Origin")
        let task = network.webSocketTask(with: request); sockets[id] = task; task.resume(); replyHandler(NSNull(), nil)
      case "fetch", "download":
        guard requests[id] == nil, let path = value["path"] as? String, path.utf8.count <= 8192 else { throw CarrierFailure.refused }
        let download = kind == "download"
        let filename = value["filename"] as? String ?? "dsh-session.zip"
        guard !download || path.hasPrefix("/api/session.export?") else { throw CarrierFailure.refused }
        let method = download ? "GET" : (value["method"] as? String ?? "")
        let headers = value["headers"] as? [String: String] ?? [:]
        guard headers.count <= 16, headers.allSatisfy({ $0.key.utf8.count <= 128 && $0.value.utf8.count <= 8192 }), filename.utf8.count <= 255 else { throw CarrierFailure.refused }
        let outgoing = try request(path, method, headers, nil)
        if !download, !(value["bodyStageId"] is NSNull) {
          guard let stageId = value["bodyStageId"] as? String, UUID(uuidString: stageId) != nil else { throw CarrierFailure.refused }
        }
        var staged: NativeBodyStage?
        if let stageId = value["bodyStageId"] as? String {
          guard method == "POST", let body = stages[stageId] else { throw CarrierFailure.refused }
          try body.requireSealed(); stages.removeValue(forKey: stageId); staged = body
        }
        let current = epoch
        let completion: (Data?, URLResponse?, Error?) -> Void = { [weak self] data, response, error in
          defer { staged?.dispose() }
          guard let self, self.epoch == current else { replyHandler(nil, "Carrier closed"); return }
          self.requests.removeValue(forKey: id)
          guard error == nil, let response = response as? HTTPURLResponse, let data else { replyHandler(nil, "Request failed"); return }
          if response.statusCode == 401 || response.statusCode == 403 { replyHandler(nil, "Access refused"); self.stop(); self.onCarrierError(["code": "access-refused"]); return }
          if download {
            guard response.statusCode == 200, response.value(forHTTPHeaderField: "Content-Type")?.hasPrefix("application/zip") == true else { replyHandler(nil, "Export unavailable"); return }
            do { try self.share(data, filename, id, replyHandler) } catch { replyHandler(nil, "Export unavailable") }
          } else {
            var headers: [String: String] = [:]
            for key in ["content-type", "content-disposition", "cache-control", "content-range", "accept-ranges"] { if let value = response.value(forHTTPHeaderField: key) { headers[key] = value } }
            replyHandler(["status": response.statusCode, "headers": headers, "body": data.base64EncodedString()], nil)
          }
        }
        let task: URLSessionDataTask
        if let staged { task = network.uploadTask(with: outgoing, fromFile: staged.file, completionHandler: completion) }
        else { task = network.dataTask(with: outgoing, completionHandler: completion) }
        requests[id] = task; task.resume()
      default: throw CarrierFailure.refused
      }
    } catch { replyHandler(nil, "Carrier refused") }
  }
  private func share(_ data: Data, _ filename: String, _ id: String, _ reply: @escaping (Any?, String?) -> Void) throws {
    guard shareController == nil, var parent = window?.rootViewController else { throw CarrierFailure.unavailable }
    while let presented = parent.presentedViewController { parent = presented }
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
    let leaf = (filename as NSString).lastPathComponent
    let safe = String(leaf.unicodeScalars.map { $0.value < 32 || $0.value == 127 ? "_" : String($0) }.joined().prefix(255))
    let file = directory.appendingPathComponent(safe.isEmpty || safe == "." || safe == ".." ? "dsh-session.zip" : safe)
    try data.write(to: file, options: .atomic)
    try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: file.path)
    exportFiles.insert(directory)
    let sheet = UIActivityViewController(activityItems: [file], applicationActivities: nil)
    sheet.popoverPresentationController?.sourceView = self
    sheet.popoverPresentationController?.sourceRect = bounds
    sheet.completionWithItemsHandler = { [weak self] _, completed, _, error in
      try? FileManager.default.removeItem(at: directory)
      self?.exportFiles.remove(directory)
      guard self?.shareRequestId == id else { return }
      self?.shareController = nil
      self?.shareReply?(completed && error == nil ? NSNull() : nil, completed && error == nil ? nil : "Export cancelled")
      self?.shareReply = nil; self?.shareRequestId = nil
    }
    shareController = sheet
    shareRequestId = id; shareReply = reply
    parent.present(sheet, animated: true)
  }
}
