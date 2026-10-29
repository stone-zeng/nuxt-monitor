// Read-only AppleSMC ABI and M3 sensor mappings adapted from Stats (MIT).
// See THIRD_PARTY_NOTICES.md. No SMC write operations are implemented.
import Foundation
import IOKit

private let hostPort = mach_host_self()

private struct SMCRequest {
    struct Version {
        var major: UInt8 = 0; var minor: UInt8 = 0
        var build: UInt8 = 0; var reserved: UInt8 = 0; var release: UInt16 = 0
    }
    struct Limits {
        var version: UInt16 = 0; var length: UInt16 = 0
        var cpu: UInt32 = 0; var gpu: UInt32 = 0; var memory: UInt32 = 0
    }
    struct KeyInfo {
        var size: UInt32 = 0; var type: UInt32 = 0; var attributes: UInt8 = 0
    }
    var key: UInt32 = 0
    var version = Version()
    var limits = Limits()
    var info = KeyInfo()
    var padding: UInt16 = 0
    var result: UInt8 = 0; var status: UInt8 = 0; var command: UInt8 = 0
    var data: UInt32 = 0
    var bytes: (UInt64, UInt64, UInt64, UInt64) = (0, 0, 0, 0)
}

private func fourCC(_ value: String) -> UInt32 {
    value.utf8.reduce(0) { ($0 << 8) | UInt32($1) }
}

private func decodeTemperature(_ bytes: [UInt8], type: UInt32) -> Double? {
    let value: Double
    if type == fourCC("flt "), bytes.count >= 4 {
        let bits = UInt32(bytes[0]) | UInt32(bytes[1]) << 8
            | UInt32(bytes[2]) << 16 | UInt32(bytes[3]) << 24
        value = Double(Float(bitPattern: bits))
    } else if type == fourCC("sp78"), bytes.count >= 2 {
        value = Double(Int16(bitPattern: UInt16(bytes[0]) << 8 | UInt16(bytes[1]))) / 256
    } else {
        return nil
    }
    return value.isFinite && value > 0 && value < 150 ? value : nil
}

private final class TemperatureReader {
    private var connection: io_connect_t = 0
    private var infoCache: [UInt32: SMCRequest.KeyInfo] = [:]
    private let cpuKeys = ["Te05", "Te0L", "Te0P", "Te0S", "Tf04", "Tf09", "Tf0A",
                           "Tf0B", "Tf0D", "Tf0E", "Tf44", "Tf49", "Tf4A", "Tf4B", "Tf4D", "Tf4E"]
    private let gpuKeys = ["Tf14", "Tf18", "Tf19", "Tf1A", "Tf24", "Tf28", "Tf29", "Tf2A"]
    private let supported: Bool

    init(chip: String) {
        supported = chip.hasPrefix("Apple M3")
        precondition(MemoryLayout<SMCRequest>.stride == 80, "Unexpected AppleSMC ABI")
        open()
    }

    private func open() {
        guard supported, connection == 0 else { return }
        let service = IOServiceGetMatchingService(kIOMainPortDefault, IOServiceMatching("AppleSMC"))
        guard service != 0 else { return }
        defer { IOObjectRelease(service) }
        if IOServiceOpen(service, mach_task_self_, 0, &connection) != KERN_SUCCESS {
            connection = 0
        }
    }

    deinit { if connection != 0 { IOServiceClose(connection) } }

    private func call(_ input: inout SMCRequest) -> SMCRequest? {
        var output = SMCRequest()
        var size = MemoryLayout<SMCRequest>.stride
        let result = IOConnectCallStructMethod(connection, 2, &input, size, &output, &size)
        guard result == KERN_SUCCESS else {
            IOServiceClose(connection)
            connection = 0
            infoCache.removeAll()
            return nil
        }
        guard output.result == 0 else { return nil }
        return output
    }

    private func read(_ key: String) -> Double? {
        guard connection != 0 else { return nil }
        var request = SMCRequest()
        request.key = fourCC(key)
        if let cached = infoCache[request.key] {
            request.info = cached
        } else {
            request.command = 9 // Read key metadata.
            guard let result = call(&request), result.info.size > 0, result.info.size <= 32 else {
                return nil
            }
            request.info = result.info
            infoCache[request.key] = result.info
        }
        request.command = 5 // Read bytes.
        guard let output = call(&request) else { return nil }
        var bytes = output.bytes
        return withUnsafeBytes(of: &bytes) {
            decodeTemperature(Array($0.prefix(Int(request.info.size))), type: request.info.type)
        }
    }

    func sample() -> (Double?, Double?) {
        open()
        func mean(_ keys: [String]) -> Double? {
            let values = keys.compactMap(read)
            return values.isEmpty ? nil : values.reduce(0, +) / Double(values.count)
        }
        return (mean(cpuKeys), mean(gpuKeys))
    }
}

private func systemString(_ name: String) -> String {
    var size = 0
    guard sysctlbyname(name, nil, &size, nil, 0) == 0, size > 0 else { return "Unknown" }
    var bytes = [CChar](repeating: 0, count: size)
    guard sysctlbyname(name, &bytes, &size, nil, 0) == 0 else { return "Unknown" }
    return bytes.withUnsafeBufferPointer { String(cString: $0.baseAddress!) }
}

private func cpuPercent(previous: [UInt32], current: [UInt32]) -> Double? {
    guard previous.count == 4, current.count == 4 else { return nil }
    let deltas = zip(current, previous).map { UInt64($0 &- $1) }
    let total = deltas.reduce(0, +)
    guard total > 0 else { return nil }
    return Double(total - deltas[Int(CPU_STATE_IDLE)]) / Double(total) * 100
}

private final class CPUReader {
    private var previous: [UInt32] = []
    func sample() -> Double? {
        // host_statistics may return cached counters at subsecond intervals.
        // Read per-processor counters and aggregate before taking the delta.
        var processors: natural_t = 0
        var info: processor_info_array_t?
        var count: mach_msg_type_number_t = 0
        let result = host_processor_info(hostPort, PROCESSOR_CPU_LOAD_INFO, &processors, &info, &count)
        guard result == KERN_SUCCESS, let info else { previous = []; return nil }
        defer {
            vm_deallocate(mach_task_self_, vm_address_t(UInt(bitPattern: info)), vm_size_t(count) * vm_size_t(MemoryLayout<integer_t>.stride))
        }
        guard processors > 0, Int(count) >= Int(processors) * Int(CPU_STATE_MAX) else {
            previous = []; return nil
        }
        var ticks = [UInt32](repeating: 0, count: Int(CPU_STATE_MAX))
        for processor in 0..<Int(processors) {
            for state in 0..<Int(CPU_STATE_MAX) {
                ticks[state] &+= UInt32(bitPattern: info[processor * Int(CPU_STATE_MAX) + state])
            }
        }
        defer { previous = ticks }
        return cpuPercent(previous: previous, current: ticks)
    }
}

private func memoryUsed(total: UInt64) -> Double? {
    var stats = vm_statistics64()
    var count = mach_msg_type_number_t(MemoryLayout<vm_statistics64>.size / MemoryLayout<integer_t>.size)
    let result = withUnsafeMutablePointer(to: &stats) {
        $0.withMemoryRebound(to: integer_t.self, capacity: Int(count)) {
            host_statistics64(hostPort, HOST_VM_INFO64, $0, &count)
        }
    }
    guard result == KERN_SUCCESS else { return nil }
    // Exclude reclaimable file cache; compressed pages count by physical size.
    let pages = Double(stats.active_count) + Double(stats.inactive_count)
        + Double(stats.speculative_count) + Double(stats.wire_count)
        + Double(stats.compressor_page_count) - Double(stats.purgeable_count)
        - Double(stats.external_page_count)
    let used = pages * Double(vm_page_size)
    return used >= 0 && used <= Double(total) ? used : nil
}

private func gpuPercent() -> Double? {
    let service = IOServiceGetMatchingService(kIOMainPortDefault, IOServiceMatching("AGXAccelerator"))
    guard service != 0 else { return nil }
    defer { IOObjectRelease(service) }
    guard let property = IORegistryEntryCreateCFProperty(service, "PerformanceStatistics" as CFString, kCFAllocatorDefault, 0),
          let stats = property.takeRetainedValue() as? [String: Any],
          let value = (stats["Device Utilization %"] as? NSNumber)?.doubleValue,
          value.isFinite, (0...100).contains(value) else { return nil }
    return value
}

private func emit(_ object: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: object, options: [.sortedKeys]) else { return }
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write(Data([10]))
}

if CommandLine.arguments.contains("--self-test") {
    precondition(MemoryLayout<SMCRequest>.stride == 80)
    precondition(decodeTemperature([0, 0, 72, 66], type: fourCC("flt ")) == 50)
    precondition(decodeTemperature([50, 128], type: fourCC("sp78")) == 50.5)
    precondition(decodeTemperature([0, 0, 192, 127], type: fourCC("flt ")) == nil)
    precondition(decodeTemperature([0, 0], type: fourCC("sp78")) == nil)
    precondition(decodeTemperature([255, 0], type: fourCC("sp78")) == nil)
    precondition(cpuPercent(previous: [10, 10, 10, 0], current: [20, 20, 30, 0]) == 50)
    precondition(cpuPercent(previous: [], current: [1, 2, 3, 4]) == nil)
    precondition(cpuPercent(previous: [10, 10, 10, 0], current: [10, 10, 10, 0]) == nil)
    precondition(cpuPercent(previous: [UInt32.max - 9, 0, UInt32.max - 9, 0], current: [10, 0, 10, 0]) == 50)
    print("Native self-tests passed")
    exit(0)
}

let chip = systemString("machdep.cpu.brand_string")
let total = ProcessInfo.processInfo.physicalMemory
private let cpu = CPUReader()
private let temperatures = TemperatureReader(chip: chip)
let parent = getppid()
let sampleFlag = CommandLine.arguments.firstIndex(of: "--samples")
let limit = sampleFlag.flatMap { $0 + 1 < CommandLine.arguments.count ? Int(CommandLine.arguments[$0 + 1]) : nil } ?? 0
let intervalFlag = CommandLine.arguments.firstIndex(of: "--interval-ms")
let intervalMilliseconds = intervalFlag.flatMap { $0 + 1 < CommandLine.arguments.count ? Double(CommandLine.arguments[$0 + 1]) : nil } ?? 500
guard intervalMilliseconds.isFinite, intervalMilliseconds >= 100 else {
    fputs("Invalid sampling interval\n", stderr)
    exit(1)
}
let interval = intervalMilliseconds / 1000
emit(["type": "device", "device": ["chip": chip, "memoryTotalBytes": total]])
var samples = 0
while getppid() == parent {
    let started = ProcessInfo.processInfo.systemUptime
    let (cpuTemperature, gpuTemperature) = temperatures.sample()
    let values: [String: Double?] = [
        "cpuPercent": cpu.sample(), "gpuPercent": gpuPercent(),
        "cpuTemperature": cpuTemperature, "gpuTemperature": gpuTemperature,
        "memoryUsedBytes": memoryUsed(total: total), "memoryTotalBytes": Double(total),
    ]
    var sample: [String: Any] = ["timestamp": Date().timeIntervalSince1970 * 1000]
    var status: [String: String] = [:]
    for (key, value) in values {
        sample[key] = value.map { $0 as Any } ?? NSNull()
        status[key] = value == nil ? "unavailable" : "ok"
    }
    sample["status"] = status
    emit(["type": "sample", "sample": sample])
    samples += 1
    if limit > 0 && samples >= limit { break }
    Thread.sleep(forTimeInterval: max(0, interval - (ProcessInfo.processInfo.systemUptime - started)))
}
