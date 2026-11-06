import { parseScl } from "./scl";
import { parseTape } from "./tape";
import { trdGeometry } from "./trd";
import { extractZip } from "./zip";
export interface LibraryFile {
  id: string;
  name: string;
  group: string | null;
  size: number;
  updatedAt: number;
  warning: string;
}
export interface StoredFile extends LibraryFile {
  bytes: Uint8Array;
}
export const fileId = (group: string | null, name: string): string =>
  JSON.stringify([group, name]);
export const fileMetadata = ({
  bytes: _bytes,
  ...metadata
}: StoredFile): LibraryFile => metadata;
export interface ImportBatch {
  files: StoredFile[];
  messages: string[];
}
export async function prepareImport(
  files: readonly File[],
): Promise<ImportBatch> {
  const result: ImportBatch = { files: [], messages: [] };
  const ids = new Set<string>();
  let total = 0;
  for (const file of files) {
    try {
      if (!/\.(tap|tzx|trd|scl|zip)$/i.test(file.name)) {
        result.messages.push(`${file.name}: unsupported file type`);
        continue;
      }
      if (file.size > 32 * 1024 * 1024)
        throw new Error("File exceeds 32 MiB import limit.");
      const bytes = new Uint8Array(await file.arrayBuffer());
      const members = /\.zip$/i.test(file.name)
        ? await extractZip(bytes)
        : [{ name: file.name, bytes }];
      if (!members.length)
        result.messages.push(`${file.name}: no TAP, TZX, TRD or SCL files`);
      for (const member of members) {
        try {
          total += member.bytes.length;
          if (total > 64 * 1024 * 1024)
            throw new Error("Batch exceeds 64 MiB extracted limit.");
          // Validate the complete 128K path; actual playback applies the machine mode.
          const scl = /\.scl$/i.test(member.name);
          const disk = scl || /\.trd$/i.test(member.name);
          const sclWarning = scl ? parseScl(member.bytes).warning : "";
          if (disk && !scl) trdGeometry(member.bytes);
          const blocks = disk ? [] : parseTape(member.bytes, member.name, true);
          const group = /\.zip$/i.test(file.name) ? file.name : null;
          const id = fileId(group, member.name);
          if (ids.has(id))
            throw new Error(
              "Duplicate path in import; split these imports to choose a replacement.",
            );
          ids.add(id);
          result.files.push({
            id,
            name: member.name,
            group,
            bytes: member.bytes,
            size: member.bytes.length,
            updatedAt: Date.now(),
            warning:
              sclWarning ||
              (blocks.some((b) => !b.checksumValid)
                ? "Contains a block with an invalid checksum"
                : /\.tzx$/i.test(member.name)
                  ? "Flash only: ROM-compatible data; stops end the loading sequence"
                  : ""),
          });
        } catch (error) {
          result.messages.push(`${member.name}: ${String(error)}`);
        }
      }
    } catch (error) {
      result.messages.push(`${file.name}: ${String(error)}`);
    }
  }
  return result;
}
