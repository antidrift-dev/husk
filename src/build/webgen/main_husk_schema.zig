//! Husk: dumps every config option as JSON (name, kind, allowed values, docs)
//! for husk's Settings window. husk/gen-settings-schema.sh turns the output
//! into macos/Sources/Husk/HuskConfigSchema+Data.swift, adding defaults from
//! `ghostty +show-config --default` (formatting them here would pull in the whole core).
const std = @import("std");
const Config = @import("../../config/Config.zig");
const help_strings = @import("help_strings");

pub fn main(init: std.process.Init) !void {
    var buffer: [4096]u8 = undefined;
    var stdout_writer = std.Io.File.stdout().writer(init.io, &buffer);
    const stdout = &stdout_writer.interface;
    try genSchema(stdout);
    try stdout.flush();
}

pub fn genSchema(writer: *std.Io.Writer) !void {
    @setEvalBranchQuota(100_000);
    try writer.writeAll("[\n");
    var first = true;
    const info = @typeInfo(Config).@"struct";
    inline for (info.field_names, info.field_types) |name, T| {
        if (name[0] == '_') continue;
        if (!first) try writer.writeAll(",\n");
        first = false;

        try writer.writeAll("{\"name\":");
        try writeString(writer, name);
        try writer.writeAll(",\"type\":");
        try writeString(writer, @typeName(T));
        try writeKind(writer, T, false);
        try writer.writeAll(",\"doc\":");
        try writeString(writer, if (@hasDecl(help_strings.Config, name))
            @field(help_strings.Config, name)
        else
            "");
        try writer.writeAll("}");
    }
    try writer.writeAll("\n]\n");
}

/// Writes `"kind":…` (and `"values":[…]` for enums and flag sets) for the type.
fn writeKind(writer: *std.Io.Writer, comptime T: type, comptime optional: bool) !void {
    if (optional) try writer.writeAll(",\"optional\":true");
    switch (@typeInfo(T)) {
        .bool => try writer.writeAll(",\"kind\":\"bool\""),
        .int => try writer.writeAll(",\"kind\":\"int\""),
        .float => try writer.writeAll(",\"kind\":\"float\""),
        .@"enum" => |info| {
            try writer.writeAll(",\"kind\":\"enum\",\"values\":[");
            inline for (info.field_names, 0..) |f, i| {
                if (i > 0) try writer.writeAll(",");
                try writeString(writer, f);
            }
            try writer.writeAll("]");
        },
        .optional => |info| try writeKind(writer, info.child, true),
        .pointer => try writer.writeAll(",\"kind\":\"string\""),
        .@"struct" => |info| {
            if (info.layout == .@"packed" and !@hasDecl(T, "formatEntry")) {
                try writer.writeAll(",\"kind\":\"flags\",\"values\":[");
                inline for (info.field_names, 0..) |f, i| {
                    if (i > 0) try writer.writeAll(",");
                    try writeString(writer, f);
                }
                try writer.writeAll("]");
            } else if (@hasField(T, "r") and @hasField(T, "g") and @hasField(T, "b")) {
                try writer.writeAll(",\"kind\":\"color\"");
            } else if (@hasField(T, "list")) {
                try writer.writeAll(",\"kind\":\"list\"");
            } else {
                try writer.writeAll(",\"kind\":\"text\"");
            }
        },
        else => try writer.writeAll(",\"kind\":\"text\""),
    }
}

fn writeString(writer: *std.Io.Writer, s: []const u8) !void {
    try writer.writeByte('"');
    for (s) |c| switch (c) {
        '"' => try writer.writeAll("\\\""),
        '\\' => try writer.writeAll("\\\\"),
        '\n' => try writer.writeAll("\\n"),
        '\r' => try writer.writeAll("\\r"),
        '\t' => try writer.writeAll("\\t"),
        0...8, 11, 12, 14...0x1f => try writer.print("\\u{x:0>4}", .{c}),
        else => try writer.writeByte(c),
    };
    try writer.writeByte('"');
}
