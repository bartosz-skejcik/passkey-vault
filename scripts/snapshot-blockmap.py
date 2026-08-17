#!/usr/bin/env python3
"""Decode a simulator app-switcher snapshot (`.ktx`) and report its block statistics.

Phase 38, Plan 38-05 (UI-08 / SC5). The `.ktx` extension is a LIE: the file's magic is
`AAPL\\r\\n\\x1a\\n`, not a KTX container, and standard image tooling refuses it -- the
single most likely way this requirement's automated check accidentally goes green
(Pitfall 10 in 38-RESEARCH.md: "no snapshot exists" is what a refused-file tool reports,
and it is wrong).

Format, as hexdumped on this machine (38-RESEARCH.md "Snapshot file decoding"):

    [8 bytes magic: AAPL \\r \\n \\x1a \\n]
    then a sequence of [u32 payloadLen (LE)][4-byte tag][payload] chunks:
        HEAD (84 bytes)  -- width/height as '<II' at ABSOLUTE FILE offset 0x28
        FILL (136 bytes) -- not used by this script
        LZFS (N bytes)   -- [u32 decompressed-length (LE)][LZFSE stream, "bvx2".."bvx$"]
        END  (0 bytes)   -- terminator

    LZFS decompresses (via /usr/lib/libcompression.dylib's compression_decode_buffer,
    algorithm COMPRESSION_LZFSE = 0x801) to raw ASTC 4x4 LDR texture data: 16 bytes per
    block, laid out on a grid of ceil(width/4) x ceil(height/4) blocks.

    An ASTC "void extent" block -- the encoding a compressor emits for a texel region
    that is a single flat colour -- has its first 8 bytes fixed at
    fc fd ff ff ff ff ff ff, and its trailing 8 bytes are `<4H` (R, G, B, A), each a
    16-bit channel value. A screen that is a single flat colour end to end therefore
    decodes to a grid where every block is void-extent AND identical.

Command-line contract: prints exactly one line to stdout, in the fixed form

    blocks=N nonflat=N distinct=N colour=X

where `colour` is the six-hex-digit RGB of the single distinct block when there is
exactly one, and the literal word `none` otherwise. These four token names are read by
38-05 Task 3's assertion via grep -- do not reword, reorder onto separate lines, or wrap
in prose. Anything else this script wants to say goes to stderr.

Exit code: 0 when the file decodes cleanly, non-zero otherwise -- a caller must not be
able to mistake a parse failure (e.g. a truncated file) for a clean, single-block
snapshot.

Pure standard library. No third-party dependencies (T-38-SC: the package-manager
supply-chain gate this repo enforces has nothing to check here because nothing is
installed).
"""

from __future__ import annotations

import argparse
import ctypes
import struct
import sys
import zlib
from pathlib import Path

MAGIC = b"AAPL\r\n\x1a\n"
VOID_EXTENT_HEADER = b"\xfc\xfd\xff\xff\xff\xff\xff\xff"
BLOCK_SIZE = 16  # bytes per ASTC 4x4 block
NONFLAT_PIXEL = (255, 0, 255)  # loud magenta -- a failing run must be visibly failing

COMPRESSION_LZFSE = 0x801


class SnapshotDecodeError(Exception):
    """Raised for any condition that means the file did not decode cleanly.

    A truncated or corrupt input must land here -- never silently report zero
    non-flat blocks, which would manufacture a false "the screen is blank" pass
    (T-38-05-05).
    """


def _read_chunks(data: bytes) -> dict[bytes, bytes]:
    if data[:8] != MAGIC:
        raise SnapshotDecodeError(
            f"not a snapshot container: expected magic {MAGIC!r}, got {data[:8]!r}"
        )
    chunks: dict[bytes, bytes] = {}
    pos = 8
    while pos < len(data):
        if pos + 8 > len(data):
            raise SnapshotDecodeError("truncated: incomplete chunk header at EOF")
        (length,) = struct.unpack_from("<I", data, pos)
        tag = data[pos + 4 : pos + 8]
        payload_start = pos + 8
        payload_end = payload_start + length
        if payload_end > len(data):
            raise SnapshotDecodeError(
                f"truncated: chunk {tag!r} declares {length} bytes but only "
                f"{len(data) - payload_start} remain"
            )
        chunks.setdefault(tag, data[payload_start:payload_end])
        if tag == b"END\x00" or length == 0 and tag[:3] == b"END":
            break
        pos = payload_end
    if b"HEAD" not in chunks:
        raise SnapshotDecodeError("truncated or malformed: no HEAD chunk found")
    if b"LZFS" not in chunks:
        raise SnapshotDecodeError("truncated or malformed: no LZFS chunk found")
    return chunks


def _dimensions(data: bytes) -> tuple[int, int]:
    if len(data) < 0x30:
        raise SnapshotDecodeError("truncated: file too short to contain a HEAD chunk")
    width, height = struct.unpack_from("<II", data, 0x28)
    if width == 0 or height == 0 or width > 20000 or height > 20000:
        raise SnapshotDecodeError(f"implausible dimensions {width}x{height} -- corrupt HEAD")
    return width, height


def _decompress_lzfse(payload: bytes, expected_len: int) -> bytes:
    if len(payload) < 4:
        raise SnapshotDecodeError("truncated: LZFS chunk too short to contain its length prefix")
    (declared_len,) = struct.unpack_from("<I", payload, 0)
    stream = payload[4:]
    if len(stream) == 0:
        raise SnapshotDecodeError("truncated: LZFS chunk has no compressed payload")

    dst_size = max(declared_len, expected_len)
    dst_buffer = ctypes.create_string_buffer(dst_size)

    try:
        lib = ctypes.CDLL("/usr/lib/libcompression.dylib")
    except OSError as exc:  # pragma: no cover -- this machine always has it
        raise SnapshotDecodeError(f"cannot load libcompression.dylib: {exc}") from exc

    lib.compression_decode_buffer.restype = ctypes.c_size_t
    lib.compression_decode_buffer.argtypes = [
        ctypes.c_char_p,
        ctypes.c_size_t,
        ctypes.c_char_p,
        ctypes.c_size_t,
        ctypes.c_void_p,
        ctypes.c_int,
    ]

    src_buffer = ctypes.create_string_buffer(stream, len(stream))
    written = lib.compression_decode_buffer(
        dst_buffer,
        dst_size,
        src_buffer,
        len(stream),
        None,
        COMPRESSION_LZFSE,
    )
    if written == 0 or written < expected_len:
        raise SnapshotDecodeError(
            f"LZFSE decompression failed or truncated: wrote {written} bytes, "
            f"needed {expected_len}"
        )
    return dst_buffer.raw[:written]


def _block_colour_hex(block: bytes) -> str:
    """Six-hex-digit RGB for a single distinct block.

    Void-extent blocks decode properly (R, G, B, A as '<4H', top byte of each 16-bit
    channel). A single distinct block that is NOT void-extent is a degenerate case this
    format was never expected to produce (it would mean every 4x4 tile in the image
    carries the identical real-content encoding) -- the contract still requires six hex
    digits, so fall back to a stable digest-derived value rather than crashing or
    guessing at a colour interpretation that doesn't apply.
    """
    if block[:8] == VOID_EXTENT_HEADER:
        r, g, b, _a = struct.unpack_from("<4H", block, 8)
        return f"{(r >> 8) & 0xFF:02x}{(g >> 8) & 0xFF:02x}{(b >> 8) & 0xFF:02x}"
    digest = zlib.crc32(block) & 0xFFFFFF
    return f"{digest:06x}"


def _write_png(path: Path, grid_w: int, grid_h: int, pixels: list[tuple[int, int, int]]) -> None:
    """Write a one-pixel-per-block RGB PNG using only zlib + struct (stdlib)."""

    def chunk(tag: bytes, payload: bytes) -> bytes:
        return (
            struct.pack(">I", len(payload))
            + tag
            + payload
            + struct.pack(">I", zlib.crc32(tag + payload) & 0xFFFFFFFF)
        )

    raw = bytearray()
    for y in range(grid_h):
        raw.append(0)  # filter type 0 (none) per scanline
        row = pixels[y * grid_w : (y + 1) * grid_w]
        for r, g, b in row:
            raw += bytes((r, g, b))

    ihdr = struct.pack(">IIBBBBB", grid_w, grid_h, 8, 2, 0, 0, 0)  # 8-bit RGB
    idat = zlib.compress(bytes(raw), 9)

    png = bytearray(b"\x89PNG\r\n\x1a\n")
    png += chunk(b"IHDR", ihdr)
    png += chunk(b"IDAT", idat)
    png += chunk(b"IEND", b"")
    path.write_bytes(bytes(png))


def decode(snapshot_path: Path, png_path: Path | None) -> str:
    data = snapshot_path.read_bytes()
    chunks = _read_chunks(data)
    width, height = _dimensions(data)

    grid_w = (width + 3) // 4
    grid_h = (height + 3) // 4
    expected_len = grid_w * grid_h * BLOCK_SIZE

    decompressed = _decompress_lzfse(chunks[b"LZFS"], expected_len)
    if len(decompressed) < expected_len:
        raise SnapshotDecodeError(
            f"decompressed payload too short: got {len(decompressed)} bytes, "
            f"needed {expected_len} for a {grid_w}x{grid_h} block grid"
        )

    total_blocks = grid_w * grid_h
    nonflat = 0
    seen: dict[bytes, None] = {}
    pixels: list[tuple[int, int, int]] = []

    for i in range(total_blocks):
        block = decompressed[i * BLOCK_SIZE : (i + 1) * BLOCK_SIZE]
        seen.setdefault(block, None)
        if block[:8] == VOID_EXTENT_HEADER:
            r, g, b, _a = struct.unpack_from("<4H", block, 8)
            pixels.append(((r >> 8) & 0xFF, (g >> 8) & 0xFF, (b >> 8) & 0xFF))
        else:
            nonflat += 1
            pixels.append(NONFLAT_PIXEL)

    distinct_blocks = list(seen.keys())
    distinct = len(distinct_blocks)
    colour = _block_colour_hex(distinct_blocks[0]) if distinct == 1 else "none"

    if png_path is not None:
        _write_png(png_path, grid_w, grid_h, pixels)

    return f"blocks={total_blocks} nonflat={nonflat} distinct={distinct} colour={colour}"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="snapshot-blockmap.py",
        description=(
            "Decode a simulator SplashBoard snapshot (.ktx, actually an AAPL/LZFSE/ASTC "
            "container) and print a block-statistics summary line."
        ),
    )
    parser.add_argument(
        "snapshot",
        type=Path,
        help="path to the snapshot file (e.g. .../SplashBoard/Snapshots/.../<UUID>@3x.ktx)",
    )
    parser.add_argument(
        "--png",
        type=Path,
        default=None,
        help=(
            "output path for the one-pixel-per-block PNG (flat blocks render as their "
            "real colour, any block with real image content renders magenta). "
            "Defaults to <snapshot>.blockmap.png next to the input file."
        ),
    )
    args = parser.parse_args(argv)

    png_path = args.png if args.png is not None else args.snapshot.with_suffix(".blockmap.png")

    try:
        summary = decode(args.snapshot, png_path)
    except SnapshotDecodeError as exc:
        print(f"snapshot-blockmap: {exc}", file=sys.stderr)
        return 1
    except (OSError, struct.error) as exc:
        print(f"snapshot-blockmap: {exc}", file=sys.stderr)
        return 1

    print(summary)
    print(f"wrote block map: {png_path}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
