import { useEffect, useState } from "react";
import type { OriginalFile } from "../domain/shared/files";

export function OriginalDownload({ original, name }: { original?: OriginalFile | string; name: string }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    setUrl("");
    if (!original) return;
    if (typeof original === "object" && !(original instanceof Blob)) { setUrl(original.downloadUrl); return; }
    const value = URL.createObjectURL(typeof original === "string" ? new Blob([original], { type: "text/plain;charset=utf-8" }) : original);
    setUrl(value);
    return () => URL.revokeObjectURL(value);
  }, [original]);
  return url ? <a href={url} download={name}>원본 다운로드</a> : null;
}
