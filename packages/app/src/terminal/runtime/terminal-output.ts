/** UTF-8 terminal bytes shared by native and DOM renderers. */
export type TerminalOutputData = Uint8Array;

let terminalOutputEncoder: TextEncoder | undefined;

/** Encode output after the app has installed its native TextEncoder polyfill. */
export function encodeTerminalOutput(text: string): TerminalOutputData {
  terminalOutputEncoder ??= new TextEncoder();
  return terminalOutputEncoder.encode(text);
}
