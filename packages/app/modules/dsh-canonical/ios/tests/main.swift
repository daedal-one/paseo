import Foundation
import SQLite3

func require(_ value: Bool) { precondition(value) }

let directory = FileManager.default.temporaryDirectory.appendingPathComponent("dsh-creation-test-" + UUID().uuidString)
defer { try? FileManager.default.removeItem(at: directory) }
let first = try CanonicalCreationStorage(documents: directory)
let second = try CanonicalCreationStorage(documents: directory)
let legacy = "{\"version\":1,\"outcome\":{\"kind\":\"unknown\"}}"
require(try first.compareExchange(hostId: "host", before: nil, after: legacy))
require(try second.read(hostId: "host") == legacy)
require(try second.compareExchange(hostId: "host", before: legacy, after: "receipt"))
require(try !first.compareExchange(hostId: "host", before: legacy, after: "duplicate"))
require(try first.read(hostId: "other") == nil)
require(try first.compareExchange(hostId: "host", before: "receipt", after: nil))
require(try second.read(hostId: "host") == nil)
do {
  _ = try CanonicalCreationStorage.validate(String(repeating: "🙂", count: 262145))
  fatalError("oversized receipt accepted")
} catch {}
let corrupt = "invalid\0receipt"
require(try first.compareExchange(hostId: "host", before: nil, after: corrupt))
require(try second.read(hostId: "host") == corrupt)
require(try first.compareExchange(hostId: "unicode", before: nil, after: "é"))
require(try !second.compareExchange(hostId: "unicode", before: "e\u{301}", after: "different bytes"))
print("Canonical creation storage: migration, CAS, Host isolation, clearing, byte bound and exact bytes passed")
