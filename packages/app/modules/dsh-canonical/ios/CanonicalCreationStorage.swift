import Foundation
import SQLite3

private enum CreationStorageFailure: Error { case unavailable, invalidRecord }
private let transientText = unsafeBitCast(-1, to: sqlite3_destructor_type.self)

/** Shares the portable app's durable per-Host slot, including unresolved version-one receipts. */
final class CanonicalCreationStorage {
  private let file: URL
  init(documents: URL) throws {
    let directory = documents.appendingPathComponent("SQLite", isDirectory: true)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    file = directory.appendingPathComponent("daedal-dsh-creation.db")
  }
  static func validate(_ value: Any?) throws -> String? {
    if value is NSNull { return nil }
    guard let text = value as? String, text.utf8.count <= 1024 * 1024 else { throw CreationStorageFailure.invalidRecord }
    return text
  }
  private func transaction<T>(_ operation: (OpaquePointer) throws -> T) throws -> T {
    var database: OpaquePointer?
    guard sqlite3_open_v2(file.path, &database, SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE | SQLITE_OPEN_FULLMUTEX, nil) == SQLITE_OK,
      let database else { if let database { sqlite3_close(database) }; throw CreationStorageFailure.unavailable }
    defer { sqlite3_close(database) }
    func exec(_ sql: String) throws {
      guard sqlite3_exec(database, sql, nil, nil, nil) == SQLITE_OK else { throw CreationStorageFailure.unavailable }
    }
    try exec("PRAGMA busy_timeout = 5000; PRAGMA synchronous = FULL; CREATE TABLE IF NOT EXISTS attempts (host_id TEXT PRIMARY KEY, payload TEXT NOT NULL)")
    try exec("BEGIN IMMEDIATE")
    do { let result = try operation(database); try exec("COMMIT"); return result }
    catch { try? exec("ROLLBACK"); throw error }
  }
  private func statement<T>(_ database: OpaquePointer, _ sql: String, _ values: [String], _ operation: (OpaquePointer) throws -> T) throws -> T {
    var statement: OpaquePointer?
    guard sqlite3_prepare_v2(database, sql, -1, &statement, nil) == SQLITE_OK, let statement else { throw CreationStorageFailure.unavailable }
    defer { sqlite3_finalize(statement) }
    for (index, value) in values.enumerated() {
      let bound = value.withCString { sqlite3_bind_text(statement, Int32(index + 1), $0, Int32(value.utf8.count), transientText) }
      guard bound == SQLITE_OK else { throw CreationStorageFailure.unavailable }
    }
    return try operation(statement)
  }
  private func read(_ database: OpaquePointer, _ hostId: String) throws -> String? {
    try statement(database, "SELECT payload FROM attempts WHERE host_id = ?", [hostId]) { statement in
      let status = sqlite3_step(statement)
      if status == SQLITE_DONE { return nil }
      guard status == SQLITE_ROW, sqlite3_column_type(statement, 0) == SQLITE_TEXT,
        let bytes = sqlite3_column_text(statement, 0) else { throw CreationStorageFailure.invalidRecord }
      let count = Int(sqlite3_column_bytes(statement, 0))
      guard count <= 1024 * 1024, let text = String(data: Data(bytes: bytes, count: count), encoding: .utf8) else { throw CreationStorageFailure.invalidRecord }
      return text
    }
  }
  func read(hostId: String) throws -> String? { try transaction { try read($0, hostId) } }
  func compareExchange(hostId: String, before: String?, after: String?) throws -> Bool {
    try transaction { database in
      let current = try read(database, hostId)
      guard current.map({ Data($0.utf8) }) == before.map({ Data($0.utf8) }) else { return false }
      let sql = after == nil ? "DELETE FROM attempts WHERE host_id = ?" : "INSERT INTO attempts (host_id, payload) VALUES (?, ?) ON CONFLICT(host_id) DO UPDATE SET payload = excluded.payload"
      let values = after.map { [hostId, $0] } ?? [hostId]
      try statement(database, sql, values) { statement in
        guard sqlite3_step(statement) == SQLITE_DONE else { throw CreationStorageFailure.unavailable }
      }
      return true
    }
  }
}
