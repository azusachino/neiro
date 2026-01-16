const std = @import("std");

const Config = struct {
    tasks: []TaskConfig,

    const TaskConfig = struct {
        name: []const u8,
        interval_seconds: ?u64 = null,
        cron_expression: ?[]const u8 = null,
        source_path: []const u8,
        s3_bucket: []const u8,
        s3_prefix: []const u8,
    };
};

pub fn main() !void {
    var gpa = std.heap.GeneralPurposeAllocator(.{}){};
    defer _ = gpa.deinit();
    const allocator = gpa.allocator();

    std.debug.print("neiro daemon starting...\n", .{});

    var last_config_check: i64 = 0;
    var parsed_config = try loadConfig(allocator, "config.json");
    defer parsed_config.deinit();

    var last_run_map = std.StringHashMap(i64).init(allocator);
    defer last_run_map.deinit();

    while (true) {
        const now = std.time.timestamp();

        // Reload config every 60 seconds
        if (now - last_config_check >= 60) {
            if (loadConfig(allocator, "config.json")) |new_parsed| {
                parsed_config.deinit();
                parsed_config = new_parsed;
                last_config_check = now;
                std.debug.print("Configuration reloaded.\n", .{});
            } else |err| {
                std.debug.print("Failed to reload configuration: {any}\n", .{err});
            }
        }

        for (parsed_config.value.tasks) |task| {
            const last_run = last_run_map.get(task.name) orelse 0;
            var should_run = false;

            if (task.interval_seconds) |interval| {
                if (now - last_run >= @as(i64, @intCast(interval))) {
                    should_run = true;
                }
            } else if (task.cron_expression) |cron_expr| {
                // Check if cron matches current time AND we haven't run in this minute yet
                // We assume cron resolution is 1 minute.
                const current_minute = @divFloor(now, 60);
                const last_run_minute = @divFloor(last_run, 60);

                if (current_minute > last_run_minute) {
                    if (isCronMatch(cron_expr, now) catch false) {
                        should_run = true;
                    }
                }
            }

            if (should_run) {
                std.debug.print("[{s}] Starting backup of {s} to s3://{s}/{s}\n", .{
                    task.name, task.source_path, task.s3_bucket, task.s3_prefix,
                });

                runBackup(allocator, task) catch |err| {
                    std.debug.print("[{s}] Backup failed: {any}\n", .{ task.name, err });
                };

                try last_run_map.put(task.name, now);
            }
        }

        std.Thread.sleep(10 * std.time.ns_per_s);
    }
}

// Basic Cron Parser (Minute Hour Day Month DayOfWeek)
// Supports: * (all), n (exact), */n (step), n,m,o (list)
fn isCronMatch(cron_expr: []const u8, timestamp: i64) !bool {
    const epoch_seconds = std.time.epoch.EpochSeconds{ .secs = @intCast(timestamp) };
    const epoch_day = epoch_seconds.getEpochDay();
    const day_seconds = epoch_day.calculateYearDay();
    const month_day = day_seconds.calculateMonthDay();
    // Manual DayOfWeek calculation (Epoch 1970-01-01 was Thursday = 4)
    // 0=Sun, 1=Mon, ..., 4=Thu, ..., 6=Sat
    const day_of_week_val = (epoch_day.day + 4) % 7;

    // Fix current values
    const day_secs = epoch_seconds.getDaySeconds();
    const values = [5]u64{
        day_secs.getMinutesIntoHour(),
        day_secs.getHoursIntoDay(),
        month_day.day_index + 1,
        month_day.month.numeric(),
        day_of_week_val // 0=Sun ... 6=Sat
    };

    var iter = std.mem.splitScalar(u8, cron_expr, ' ');
    var field_idx: usize = 0;

    while (iter.next()) |field| {
        if (field_idx >= 5) break;
        if (field.len == 0) continue; // handle extra spaces

        const val = values[field_idx];
        if (!try matchField(field, val)) return false;
        field_idx += 1;
    }
    
    return field_idx == 5;
}

fn matchField(pattern: []const u8, value: u64) !bool {
    if (std.mem.eql(u8, pattern, "*")) return true;

    // Step: */n
    if (std.mem.indexOf(u8, pattern, "/")) |slash_idx| {
        if (slash_idx == 0 or pattern[0] != '*') return false; // Only support */n for now
        const step_str = pattern[slash_idx + 1 ..];
        const step = try std.fmt.parseInt(u64, step_str, 10);
        return (value % step) == 0;
    }

    // List: 1,2,3
    if (std.mem.indexOf(u8, pattern, ",")) |_| {
        var iter = std.mem.splitScalar(u8, pattern, ',');
        while (iter.next()) |part| {
            const expected = try std.fmt.parseInt(u64, part, 10);
            if (value == expected) return true;
        }
        return false;
    }

    // Exact: n
    const expected = std.fmt.parseInt(u64, pattern, 10) catch return false;
    return value == expected;
}

fn loadConfig(allocator: std.mem.Allocator, path: []const u8) !std.json.Parsed(Config) {
    const file = try std.fs.cwd().openFile(path, .{});
    defer file.close();

    const content = try file.readToEndAlloc(allocator, 1024 * 1024);
    defer allocator.free(content);

    return std.json.parseFromSlice(Config, allocator, content, .{ .ignore_unknown_fields = true });
}

fn runBackup(allocator: std.mem.Allocator, task: Config.TaskConfig) !void {
    const tmp_archive = try std.fmt.allocPrint(allocator, "/tmp/{s}.tar.gz", .{task.name});

    defer allocator.free(tmp_archive);
    {
        var child = std.process.Child.init(&[_][]const u8{ "tar", "-czf", tmp_archive, "-C", std.fs.path.dirname(task.source_path) orelse ".", std.fs.path.basename(task.source_path) }, allocator);

        const term = try child.spawnAndWait();

        if (term != .Exited or term.Exited != 0) return error.TarFailed;
    }

    {
        const s3_path = try std.fmt.allocPrint(allocator, "s3://{s}/{s}{s}.tar.gz", .{ task.s3_bucket, task.s3_prefix, task.name });

        defer allocator.free(s3_path);

        var child = std.process.Child.init(&[_][]const u8{ "aws", "s3", "cp", tmp_archive, s3_path }, allocator);

        const term = try child.spawnAndWait();

        if (term != .Exited or term.Exited != 0) return error.S3UploadFailed;
    }

    std.fs.deleteFileAbsolute(tmp_archive) catch {};
}
