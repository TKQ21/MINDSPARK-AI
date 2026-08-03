import { parseTableFile } from "@/lib/clientTableParse";

self.onmessage = (event: MessageEvent<{ bytes: ArrayBuffer; fileName: string }>) => {
  try {
    const text = parseTableFile(new Uint8Array(event.data.bytes), event.data.fileName);
    self.postMessage({ text });
  } catch (error: any) {
    self.postMessage({ error: error?.message || "table parse failed" });
  }
};
