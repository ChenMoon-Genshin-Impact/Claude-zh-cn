#!/usr/bin/env node
/**
 * bun-binary-io.js �?Bun 原生二进�?I/O 工具
 *
 * �?tweakcc (Piebald-AI/tweakcc) �?nativeInstallation.ts 精简移植�?
 * 仅支�?macOS (Mach-O)，v1 标记为实验性功能�?
 *
 * CLI 子命令：
 *   detect <claude-cmd>     �?输出 "npm:<path>" �?"native-bun:<path>" �?"unknown"
 *   extract <binary> <out>  �?提取内嵌 JS �?<out>
 *   repack <binary> <js>    �?将修改后�?JS 写回二进制（�?codesign�?
 *   version <binary>        �?输出二进制内嵌的版本�?
 *   resolve <path>          �?输出 realpath（跨平台 symlink 解析�?
 *   check-deps              �?检�?node-lief 是否可用
 */

"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execSync, execFileSync } = require("child_process");

// ============================================================================
// 常量
// ============================================================================

const BUN_TRAILER = Buffer.from("\n---- Bun! ----\n");
const SIZEOF_OFFSETS = 32;
const SIZEOF_STRING_POINTER = 8;
const SIZEOF_MODULE_OLD = 4 * SIZEOF_STRING_POINTER + 4; // 36
const SIZEOF_MODULE_NEW = 6 * SIZEOF_STRING_POINTER + 4; // 52

// ============================================================================
// node-lief 加载
// ============================================================================

function loadNodeLief() {
  // 1. 直接 require
  try { return require("node-lief"); } catch {}
  // 2. npm root -g
  try {
    const globalRoot = execSync("npm root -g", { encoding: "utf8" }).trim();
    return require(path.join(globalRoot, "node-lief"));
  } catch {}
  return null;
}

// ============================================================================
// 二进制格式检�?
// ============================================================================

function hasBunTrailer(filePath) {
  try {
    const stat = fs.statSync(filePath);
    if (stat.size < BUN_TRAILER.length) return false;
    const fd = fs.openSync(filePath, "r");
    const chunkSize = 1024 * 1024;
    const overlap = BUN_TRAILER.length - 1;
    const buf = Buffer.alloc(chunkSize + overlap);
    let carry = 0;
    let position = 0;

    try {
      while (position < stat.size) {
        const bytesRead = fs.readSync(fd, buf, carry, chunkSize, position);
        if (bytesRead <= 0) break;
        const searchLength = carry + bytesRead;
        if (buf.subarray(0, searchLength).includes(BUN_TRAILER)) return true;
        if (searchLength > overlap) {
          buf.copyWithin(0, searchLength - overlap, searchLength);
          carry = overlap;
        } else {
          carry = searchLength;
        }
        position += bytesRead;
      }
      return false;
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return false;
  }
}

function detectBinaryFormat(filePath) {
  try {
    const magic = Buffer.alloc(4);
    const fd = fs.openSync(filePath, "r");
    fs.readSync(fd, magic, 0, 4, 0);
    fs.closeSync(fd);
    // Mach-O 64-bit little-endian
    if (magic[0] === 0xCF && magic[1] === 0xFA && magic[2] === 0xED && magic[3] === 0xFE) return "MachO64";
    // Mach-O 32-bit little-endian
    if (magic[0] === 0xCE && magic[1] === 0xFA && magic[2] === 0xED && magic[3] === 0xFE) return "MachO32";
    // ELF
    if (magic[0] === 0x7F && magic[1] === 0x45 && magic[2] === 0x4C && magic[3] === 0x46) return "ELF";
    // PE (Windows)
    if (magic[0] === 0x4D && magic[1] === 0x5A) return "PE";
    return "unknown";
  } catch {
    return "unknown";
  }
}

// ============================================================================
// 安装检�?
// ============================================================================

function detectInstallation(claudeCmd) {
  // 1. 解析 symlink �?realpath
  let realPath;
  try { realPath = fs.realpathSync(claudeCmd); } catch { return "unknown"; }

  // 2. 先判真实目标本身是不�?Bun 二进制（Codex 二审 #1�?
  //    PE 格式暂不支持 repack，跳�?CLI Patch（设置和 Hook 仍生效）
  const format = detectBinaryFormat(realPath);
  if ((format === "MachO64" || format === "MachO32" || format === "ELF") && hasBunTrailer(realPath)) {
    return "native-bun:" + realPath;
  }

  // 3. 不是二进�?�?检查是否在 npm 布局�?(Unix: ../lib/node_modules/, Windows: node_modules/)
  const npmCli = path.resolve(path.dirname(realPath),
    "../lib/node_modules/@anthropic-ai/claude-code/cli.js");
  if (fs.existsSync(npmCli)) return "npm:" + npmCli;

  const npmCliWin = path.resolve(path.dirname(realPath),
    "node_modules/@anthropic-ai/claude-code/cli.js");
  if (fs.existsSync(npmCliWin)) return "npm:" + npmCliWin;

  // 4. npm 安装的原生二进制 (v2.x+)
  const npmExe = path.resolve(path.dirname(realPath),
    "node_modules/@anthropic-ai/claude-code/bin/claude.exe");
  if (fs.existsSync(npmExe)) {
    const exeFormat = detectBinaryFormat(npmExe);
    if ((exeFormat === "MachO64" || exeFormat === "MachO32" || exeFormat === "ELF") && hasBunTrailer(npmExe)) {
      return "native-bun:" + npmExe;
    }
  }

  // 5. npm root -g 兜底
  try {
    const globalRoot = execSync("npm root -g", { encoding: "utf8" }).trim();

    const npmCli2 = path.join(globalRoot, "@anthropic-ai/claude-code/cli.js");
    if (fs.existsSync(npmCli2)) return "npm:" + npmCli2;

    const npmExe2 = path.join(globalRoot, "@anthropic-ai/claude-code/bin/claude.exe");
    if (fs.existsSync(npmExe2)) {
      const exeFormat2 = detectBinaryFormat(npmExe2);
      if ((exeFormat2 === "PE" || exeFormat2 === "MachO64" || exeFormat2 === "MachO32" || exeFormat2 === "ELF") && hasBunTrailer(npmExe2)) {
        return "native-bun:" + npmExe2;
      }
    }
  } catch {}

  return "unknown";
}

// ============================================================================
// Bun 数据解析（纯 Buffer 操作，基�?tweakcc�?
// ============================================================================

function parseStringPointer(buffer, offset) {
  return {
    offset: buffer.readUInt32LE(offset),
    length: buffer.readUInt32LE(offset + 4),
  };
}

function getStringPointerContent(buffer, sp) {
  return buffer.subarray(sp.offset, sp.offset + sp.length);
}

function parseOffsets(buffer) {
  let pos = 0;
  const offsetsOffset = buffer.readBigUInt64LE(pos);
  pos += 8;
  const modulesPtr = parseStringPointer(buffer, pos);
  pos += 8;
  const entryPointId = buffer.readUInt32LE(pos);
  pos += 4;
  const compileExecArgvPtr = parseStringPointer(buffer, pos);
  pos += 8;
  const flags = buffer.readUInt32LE(pos);
  return { offsetsOffset, modulesPtr, entryPointId, compileExecArgvPtr, flags };
}

function detectModuleStructSize(modulesListLength) {
  const fitsNew = modulesListLength % SIZEOF_MODULE_NEW === 0;
  const fitsOld = modulesListLength % SIZEOF_MODULE_OLD === 0;
  if (fitsNew && !fitsOld) return SIZEOF_MODULE_NEW;
  if (fitsOld && !fitsNew) return SIZEOF_MODULE_OLD;
  // 歧义时优先新格式
  return SIZEOF_MODULE_NEW;
}

function isClaudeModule(moduleName) {
  return moduleName.endsWith("/claude") ||
    moduleName === "claude" ||
    moduleName.endsWith("/src/entrypoints/cli.js") ||
    moduleName === "src/entrypoints/cli.js";
}

function parseCompiledModule(buffer, offset, moduleStructSize) {
  let pos = offset;
  const name = parseStringPointer(buffer, pos); pos += 8;
  const contents = parseStringPointer(buffer, pos); pos += 8;
  const sourcemap = parseStringPointer(buffer, pos); pos += 8;
  const bytecode = parseStringPointer(buffer, pos); pos += 8;

  let moduleInfo, bytecodeOriginPath;
  if (moduleStructSize === SIZEOF_MODULE_NEW) {
    moduleInfo = parseStringPointer(buffer, pos); pos += 8;
    bytecodeOriginPath = parseStringPointer(buffer, pos); pos += 8;
  } else {
    moduleInfo = { offset: 0, length: 0 };
    bytecodeOriginPath = { offset: 0, length: 0 };
  }

  const encoding = buffer.readUInt8(pos); pos += 1;
  const loader = buffer.readUInt8(pos); pos += 1;
  const moduleFormat = buffer.readUInt8(pos); pos += 1;
  const side = buffer.readUInt8(pos);

  return { name, contents, sourcemap, bytecode, moduleInfo, bytecodeOriginPath, encoding, loader, moduleFormat, side };
}

function parseBunDataBlob(bunDataContent) {
  if (bunDataContent.length < SIZEOF_OFFSETS + BUN_TRAILER.length) {
    throw new Error("BUN data is too small");
  }

  // 验证 trailer
  const trailerStart = bunDataContent.length - BUN_TRAILER.length;
  if (!bunDataContent.subarray(trailerStart).equals(BUN_TRAILER)) {
    throw new Error("BUN trailer mismatch");
  }

  // 解析 Offsets
  const offsetsStart = bunDataContent.length - SIZEOF_OFFSETS - BUN_TRAILER.length;
  const bunOffsets = parseOffsets(bunDataContent.subarray(offsetsStart, offsetsStart + SIZEOF_OFFSETS));
  const moduleStructSize = detectModuleStructSize(bunOffsets.modulesPtr.length);

  return { bunOffsets, bunData: bunDataContent, moduleStructSize };
}

// Section format: [u32/u64 size header][bun data blob...]
function extractBunDataFromSection(sectionData) {
  if (sectionData.length < 4) throw new Error("Section data too small");

  // 尝试 u32 header（旧格式�?
  const bunDataSizeU32 = sectionData.readUInt32LE(0);
  const expectedLengthU32 = 4 + bunDataSizeU32;

  // 尝试 u64 header（新格式�?
  const bunDataSizeU64 = sectionData.length >= 8 ? Number(sectionData.readBigUInt64LE(0)) : 0;
  const expectedLengthU64 = 8 + bunDataSizeU64;

  let headerSize, bunDataSize;

  if (sectionData.length >= 8 && expectedLengthU64 <= sectionData.length && expectedLengthU64 >= sectionData.length - 4096) {
    headerSize = 8;
    bunDataSize = bunDataSizeU64;
  } else if (expectedLengthU32 <= sectionData.length && expectedLengthU32 >= sectionData.length - 4096) {
    headerSize = 4;
    bunDataSize = bunDataSizeU32;
  } else {
    throw new Error("Cannot determine section header format");
  }

  const bunDataContent = sectionData.subarray(headerSize, headerSize + bunDataSize);
  const parsed = parseBunDataBlob(bunDataContent);
  return { ...parsed, sectionHeaderSize: headerSize };
}

// ============================================================================
// 使用 node-lief 的提�?重打�?
// ============================================================================

function extractFromMachO(LIEF, binaryPath) {
  LIEF.logging.disable();
  const binary = LIEF.parse(binaryPath);

  const bunSegment = binary.getSegment("__BUN");
  if (!bunSegment) throw new Error("__BUN segment not found");
  const bunSection = bunSegment.getSection("__bun");
  if (!bunSection) throw new Error("__bun section not found");

  return extractBunDataFromSection(bunSection.content);
}

function extractFromELF(LIEF, binaryPath) {
  LIEF.logging.disable();
  const binary = LIEF.parse(binaryPath);

  const bunSection = binary.getSection(".bun");
  if (!bunSection) throw new Error(".bun section not found");

  return { ...extractBunDataFromSection(bunSection.content), elfSectionOffset: Number(bunSection.fileOffset) };
}

function extractFromBinary(LIEF, binaryPath) {
  const format = detectBinaryFormat(binaryPath);
  if (format === "MachO64" || format === "MachO32") {
    return extractFromMachO(LIEF, binaryPath);
  }
  if (format === "ELF") {
    return extractFromELF(LIEF, binaryPath);
  }
  throw new Error(`Unsupported binary format: ${format}`);
}

function findClaudeModule(bunData, bunOffsets, moduleStructSize) {
  const modulesListBytes = getStringPointerContent(bunData, bunOffsets.modulesPtr);
  const count = Math.floor(modulesListBytes.length / moduleStructSize);

  for (let i = 0; i < count; i++) {
    const mod = parseCompiledModule(modulesListBytes, i * moduleStructSize, moduleStructSize);
    const moduleName = getStringPointerContent(bunData, mod.name).toString("utf-8");
    if (isClaudeModule(moduleName)) {
      return {
        module: mod,
        moduleName,
        contents: getStringPointerContent(bunData, mod.contents),
      };
    }
  }
  return null;
}

function rebuildBunData(bunData, bunOffsets, modifiedClaudeJs, moduleStructSize) {
  const modulesListBytes = getStringPointerContent(bunData, bunOffsets.modulesPtr);
  const count = Math.floor(modulesListBytes.length / moduleStructSize);

  // Phase 1: 收集所有模块数�?
  const stringsData = [];
  const modulesMetadata = [];

  for (let i = 0; i < count; i++) {
    const mod = parseCompiledModule(modulesListBytes, i * moduleStructSize, moduleStructSize);
    const nameBytes = getStringPointerContent(bunData, mod.name);
    const moduleName = nameBytes.toString("utf-8");

    const contentsBytes = (modifiedClaudeJs && isClaudeModule(moduleName))
      ? modifiedClaudeJs
      : getStringPointerContent(bunData, mod.contents);
    const sourcemapBytes = getStringPointerContent(bunData, mod.sourcemap);
    const bytecodeBytes = getStringPointerContent(bunData, mod.bytecode);
    const moduleInfoBytes = getStringPointerContent(bunData, mod.moduleInfo);
    const bytecodeOriginPathBytes = getStringPointerContent(bunData, mod.bytecodeOriginPath);

    modulesMetadata.push({
      name: nameBytes, contents: contentsBytes, sourcemap: sourcemapBytes,
      bytecode: bytecodeBytes, moduleInfo: moduleInfoBytes, bytecodeOriginPath: bytecodeOriginPathBytes,
      encoding: mod.encoding, loader: mod.loader, moduleFormat: mod.moduleFormat, side: mod.side,
    });

    if (moduleStructSize === SIZEOF_MODULE_NEW) {
      stringsData.push(nameBytes, contentsBytes, sourcemapBytes, bytecodeBytes, moduleInfoBytes, bytecodeOriginPathBytes);
    } else {
      stringsData.push(nameBytes, contentsBytes, sourcemapBytes, bytecodeBytes);
    }
  }

  const stringsPerModule = moduleStructSize === SIZEOF_MODULE_NEW ? 6 : 4;

  // Phase 2: 计算布局
  let currentOffset = 0;
  const stringOffsets = [];
  for (const s of stringsData) {
    stringOffsets.push({ offset: currentOffset, length: s.length });
    currentOffset += s.length + 1; // +1 null terminator
  }

  const modulesListOffset = currentOffset;
  const modulesListSize = modulesMetadata.length * moduleStructSize;
  currentOffset += modulesListSize;

  const compileExecArgvBytes = getStringPointerContent(bunData, bunOffsets.compileExecArgvPtr);
  const compileExecArgvOffset = currentOffset;
  const compileExecArgvLength = compileExecArgvBytes.length;
  currentOffset += compileExecArgvLength + 1;

  const offsetsOffset = currentOffset;
  currentOffset += SIZEOF_OFFSETS;
  const trailerOffset = currentOffset;
  currentOffset += BUN_TRAILER.length;

  // Phase 3: 写入
  const newBuf = Buffer.allocUnsafe(currentOffset);
  newBuf.fill(0);

  let stringIdx = 0;
  for (const { offset, length } of stringOffsets) {
    if (length > 0) stringsData[stringIdx].copy(newBuf, offset, 0, length);
    newBuf[offset + length] = 0;
    stringIdx++;
  }

  if (compileExecArgvLength > 0) {
    compileExecArgvBytes.copy(newBuf, compileExecArgvOffset, 0, compileExecArgvLength);
    newBuf[compileExecArgvOffset + compileExecArgvLength] = 0;
  }

  for (let i = 0; i < modulesMetadata.length; i++) {
    const meta = modulesMetadata[i];
    const base = i * stringsPerModule;
    const modStruct = {
      name: stringOffsets[base], contents: stringOffsets[base + 1],
      sourcemap: stringOffsets[base + 2], bytecode: stringOffsets[base + 3],
      moduleInfo: moduleStructSize === SIZEOF_MODULE_NEW ? stringOffsets[base + 4] : { offset: 0, length: 0 },
      bytecodeOriginPath: moduleStructSize === SIZEOF_MODULE_NEW ? stringOffsets[base + 5] : { offset: 0, length: 0 },
      encoding: meta.encoding, loader: meta.loader, moduleFormat: meta.moduleFormat, side: meta.side,
    };

    const modOffset = modulesListOffset + i * moduleStructSize;
    let pos = modOffset;
    newBuf.writeUInt32LE(modStruct.name.offset, pos); newBuf.writeUInt32LE(modStruct.name.length, pos + 4); pos += 8;
    newBuf.writeUInt32LE(modStruct.contents.offset, pos); newBuf.writeUInt32LE(modStruct.contents.length, pos + 4); pos += 8;
    newBuf.writeUInt32LE(modStruct.sourcemap.offset, pos); newBuf.writeUInt32LE(modStruct.sourcemap.length, pos + 4); pos += 8;
    newBuf.writeUInt32LE(modStruct.bytecode.offset, pos); newBuf.writeUInt32LE(modStruct.bytecode.length, pos + 4); pos += 8;
    if (moduleStructSize === SIZEOF_MODULE_NEW) {
      newBuf.writeUInt32LE(modStruct.moduleInfo.offset, pos); newBuf.writeUInt32LE(modStruct.moduleInfo.length, pos + 4); pos += 8;
      newBuf.writeUInt32LE(modStruct.bytecodeOriginPath.offset, pos); newBuf.writeUInt32LE(modStruct.bytecodeOriginPath.length, pos + 4); pos += 8;
    }
    newBuf.writeUInt8(modStruct.encoding, pos); newBuf.writeUInt8(modStruct.loader, pos + 1);
    newBuf.writeUInt8(modStruct.moduleFormat, pos + 2); newBuf.writeUInt8(modStruct.side, pos + 3);
  }

  // 写入 Offsets
  let op = offsetsOffset;
  newBuf.writeBigUInt64LE(BigInt(offsetsOffset), op); op += 8;
  newBuf.writeUInt32LE(modulesListOffset, op); newBuf.writeUInt32LE(modulesListSize, op + 4); op += 8;
  newBuf.writeUInt32LE(bunOffsets.entryPointId, op); op += 4;
  newBuf.writeUInt32LE(compileExecArgvOffset, op); newBuf.writeUInt32LE(compileExecArgvLength, op + 4); op += 8;
  newBuf.writeUInt32LE(bunOffsets.flags, op);

  // 写入 trailer
  BUN_TRAILER.copy(newBuf, trailerOffset);

  return newBuf;
}

function buildSectionData(bunBuffer, headerSize) {
  const sectionData = Buffer.allocUnsafe(headerSize + bunBuffer.length);
  if (headerSize === 8) {
    sectionData.writeBigUInt64LE(BigInt(bunBuffer.length), 0);
  } else {
    sectionData.writeUInt32LE(bunBuffer.length, 0);
  }
  bunBuffer.copy(sectionData, headerSize);
  return sectionData;
}

function atomicWriteBinary(LIEF, binary, outputPath, originalPath) {
  const tempPath = outputPath + ".tmp";
  binary.write(tempPath);
  try {
    const origStat = fs.statSync(originalPath);
    fs.chmodSync(tempPath, origStat.mode);
  } catch {}
  try {
    fs.renameSync(tempPath, outputPath);
  } catch (error) {
    try { if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath); } catch {}
    if (error && (error.code === "ETXTBSY" || error.code === "EBUSY" || error.code === "EPERM")) {
      throw new Error("Cannot update the Claude executable while it is running. Please close all Claude instances and try again.");
    }
    throw error;
  }
}

function repackMachO(LIEF, machoBinary, binPath, newBunBuffer, outputPath, sectionHeaderSize) {
  // 移除旧签�?
  if (machoBinary.hasCodeSignature) {
    machoBinary.removeSignature();
  }

  const bunSegment = machoBinary.getSegment("__BUN");
  if (!bunSegment) throw new Error("__BUN segment not found");
  const bunSection = bunSegment.getSection("__bun");
  if (!bunSection) throw new Error("__bun section not found");

  const newSectionData = buildSectionData(newBunBuffer, sectionHeaderSize);
  const sizeDiff = newSectionData.length - Number(bunSection.size);

  if (sizeDiff > 0) {
    const isARM64 = machoBinary.header.cpuType === LIEF.MachO.Header.CPU_TYPE.ARM64;
    const PAGE_SIZE = isARM64 ? 16384 : 4096;
    const alignedSizeDiff = Math.ceil(sizeDiff / PAGE_SIZE) * PAGE_SIZE;
    const success = machoBinary.extendSegment(bunSegment, alignedSizeDiff);
    if (!success) throw new Error("Failed to extend __BUN segment");
  }

  bunSection.content = newSectionData;
  bunSection.size = BigInt(newSectionData.length);

  atomicWriteBinary(LIEF, machoBinary, outputPath, binPath);

  // macOS 重签�?
  try {
    execFileSync("codesign", ["-s", "-", "-f", outputPath], { stdio: "ignore" });
  } catch {
    process.stderr.write("Warning: codesign failed, binary may not run on macOS\n");
  }
}

function repackELF(binPath, newBunBuffer, elfSectionOffset, sectionHeaderSize) {
  const newSectionData = buildSectionData(newBunBuffer, sectionHeaderSize);

  // 读取原始 section 大小（优先从备份读取，避�?ETXTBSY�?
  const backupPath = binPath + ".zh-cn-backup";
  const readSource = fs.existsSync(backupPath) ? backupPath : binPath;
  const fd = fs.openSync(readSource, "r");
  const origHeader = Buffer.alloc(sectionHeaderSize);
  fs.readSync(fd, origHeader, 0, sectionHeaderSize, elfSectionOffset);
  fs.closeSync(fd);

  const origDataSize = sectionHeaderSize === 8
    ? Number(origHeader.readBigUInt64LE(0))
    : origHeader.readUInt32LE(0);
  const origSectionSize = sectionHeaderSize + origDataSize;

  if (newSectionData.length > origSectionSize) {
    throw new Error(
      `New bun data (${newSectionData.length} bytes) exceeds ELF .bun section capacity (${origSectionSize} bytes). ` +
      `Size increase of ${newSectionData.length - origSectionSize} bytes cannot be accommodated.`
    );
  }

  // 从备份复制到临时文件再写入（避免 ETXTBSY，原始二进制可能正在运行�?
  const tmpPath = binPath + ".zh-cn-tmp";
  fs.copyFileSync(readSource, tmpPath);
  try {
    const fd2 = fs.openSync(tmpPath, "r+");
    try {
      fs.writeSync(fd2, newSectionData, 0, newSectionData.length, elfSectionOffset);
      if (newSectionData.length < origSectionSize) {
        const padding = Buffer.alloc(origSectionSize - newSectionData.length);
        fs.writeSync(fd2, padding, 0, padding.length, elfSectionOffset + newSectionData.length);
      }
    } finally {
      fs.closeSync(fd2);
    }

    // 恢复原始文件权限
    const origStat = fs.statSync(readSource);
    fs.chmodSync(tmpPath, origStat.mode);

    // 原子替换
    fs.renameSync(tmpPath, binPath);
  } catch (error) {
    try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch {}
    if (error && (error.code === "ETXTBSY" || error.code === "EBUSY" || error.code === "EPERM")) {
      throw new Error("Cannot update the Claude executable while it is running. Please close all Claude instances and try again.");
    }
    throw error;
  }
}

// ============================================================================
// CLI 子命令实�?
// ============================================================================

function cmdDetect() {
  const claudeCmd = process.argv[3];
  if (!claudeCmd) { process.stdout.write("unknown"); return; }
  const result = detectInstallation(claudeCmd);
  process.stdout.write(result);
}

function cmdExtract() {
  const binaryPath = process.argv[3];
  const outputPath = process.argv[4];
  if (!binaryPath || !outputPath) {
    process.stderr.write("Usage: bun-binary-io.js extract <binary> <output>\n");
    process.exit(1);
  }

  const LIEF = loadNodeLief();
  if (!LIEF) {
    process.stderr.write("Error: node-lief not found. Install with: npm install -g node-lief\n");
    process.exit(1);
  }

  const { bunData, bunOffsets, moduleStructSize } = extractFromBinary(LIEF, binaryPath);
  const found = findClaudeModule(bunData, bunOffsets, moduleStructSize);
  if (!found || found.contents.length === 0) {
    process.stderr.write("Error: claude module not found in binary\n");
    process.exit(1);
  }

  fs.writeFileSync(outputPath, found.contents);
  process.stdout.write("ok");
}

function cmdRepack() {
  const binaryPath = process.argv[3];
  const jsPath = process.argv[4];
  if (!binaryPath || !jsPath) {
    process.stderr.write("Usage: bun-binary-io.js repack <binary> <js-file>\n");
    process.exit(1);
  }

  const LIEF = loadNodeLief();
  if (!LIEF) {
    process.stderr.write("Error: node-lief not found. Install with: npm install -g node-lief\n");
    process.exit(1);
  }

  LIEF.logging.disable();
  const modifiedJs = fs.readFileSync(jsPath);

  const format = detectBinaryFormat(binaryPath);
  const extracted = extractFromBinary(LIEF, binaryPath);
  const { bunOffsets, bunData, sectionHeaderSize, moduleStructSize } = extracted;
  const newBuffer = rebuildBunData(bunData, bunOffsets, modifiedJs, moduleStructSize);

  if (format === "MachO64" || format === "MachO32") {
    const binary = LIEF.parse(binaryPath);
    repackMachO(LIEF, binary, binaryPath, newBuffer, binaryPath, sectionHeaderSize);
  } else if (format === "ELF") {
    const elfSectionOffset = extracted.elfSectionOffset;
    repackELF(binaryPath, newBuffer, elfSectionOffset, sectionHeaderSize);
  } else {
    process.stderr.write(`Error: unsupported binary format: ${format}\n`);
    process.exit(1);
  }

  process.stdout.write("ok");
}

function cmdVersion() {
  const binaryPath = process.argv[3];
  if (!binaryPath) {
    process.stderr.write("Usage: bun-binary-io.js version <binary>\n");
    process.exit(1);
  }

  const LIEF = loadNodeLief();
  if (!LIEF) {
    process.stdout.write("");
    return;
  }

  try {
    const { bunData, bunOffsets, moduleStructSize } = extractFromBinary(LIEF, binaryPath);
    const found = findClaudeModule(bunData, bunOffsets, moduleStructSize);
    if (found && found.contents.length > 0) {
      // �?JS 内容头部提取版本号（匹配 "// Version: X.Y.Z" 格式�?
      const header = found.contents.subarray(0, 1000).toString("utf-8");
      const match = header.match(/\/\/ Version: (\S+)/);
      if (match) {
        process.stdout.write(match[1]);
        return;
      }
    }
    process.stdout.write("");
  } catch {
    process.stdout.write("");
  }
}

function cmdResolve() {
  const inputPath = process.argv[3];
  if (!inputPath) {
    process.stderr.write("Usage: bun-binary-io.js resolve <path>\n");
    process.exit(1);
  }
  try {
    process.stdout.write(fs.realpathSync(inputPath));
  } catch {
    process.stdout.write(inputPath);
  }
}

function cmdCheckDeps() {
  const LIEF = loadNodeLief();
  process.stdout.write(LIEF ? "ok" : "missing");
}

function cmdHash() {
  const binaryPath = process.argv[3];
  if (!binaryPath) {
    process.stderr.write("Usage: bun-binary-io.js hash <binary>\n");
    process.exit(1);
  }

  const hash = crypto.createHash("sha256");
  const fd = fs.openSync(binaryPath, "r");
  const buffer = Buffer.alloc(1024 * 1024);
  try {
    let bytesRead = 0;
    do {
      bytesRead = fs.readSync(fd, buffer, 0, buffer.length, null);
      if (bytesRead > 0) {
        hash.update(buffer.subarray(0, bytesRead));
      }
    } while (bytesRead > 0);
  } finally {
    fs.closeSync(fd);
  }

  process.stdout.write(hash.digest("hex"));
}

// ============================================================================
// CLI 入口
// ============================================================================

const command = process.argv[2];
switch (command) {
  case "detect": cmdDetect(); break;
  case "extract": cmdExtract(); break;
  case "repack": cmdRepack(); break;
  case "version": cmdVersion(); break;
  case "resolve": cmdResolve(); break;
  case "check-deps": cmdCheckDeps(); break;
  case "hash": cmdHash(); break;
  default:
    process.stderr.write(
      "Usage: bun-binary-io.js <command> [args...]\n" +
      "Commands: detect, extract, repack, version, resolve, check-deps, hash\n"
    );
    process.exit(1);
}
