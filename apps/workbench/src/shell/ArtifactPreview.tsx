import type { ArtifactRecord } from "@gujian/domain";

import { ARTIFACT_KIND_LABELS } from "../labels";
import { Button } from "../ui";
import { FileViewer, viewerKindOf } from "../ui/FileViewer";
import { useAssetBlob } from "../workbench/useAssetUrls";

// 成果预览对话框（实施单元 09）：点一份成果在页内看，不用先下载。
// 能看的类型交给统一查看器；看不了的类型也进对话框，里面说明原因并给下载。
export function previewable(artifact: { mimeType: string; fileName: string }): boolean {
  return viewerKindOf(artifact.mimeType, artifact.fileName) !== "unsupported";
}

export function ArtifactPreviewDialog({ artifact, onClose, onDownload }: {
  artifact: ArtifactRecord;
  onClose: () => void;
  onDownload: (artifact: ArtifactRecord) => void;
}) {
  const asset = useAssetBlob(artifact.assetId);
  return (
    <div className="gj-scrim" role="presentation" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="gj-dialog ws-preview-dialog" role="dialog" aria-modal="true" aria-labelledby="ws-preview-title">
        <div className="ws-preview-head">
          <div>
            <h2 className="gj-dialog-title" id="ws-preview-title">{ARTIFACT_KIND_LABELS[artifact.kind] ?? artifact.kind}</h2>
            <span className="gj-note gj-numeric">{artifact.fileName} · {Math.max(1, Math.round(artifact.byteLength / 1024))} KB</span>
          </div>
          <div className="gj-actions">
            <Button onClick={() => onDownload(artifact)}>下载</Button>
            <Button variant="primary" onClick={onClose}>关闭</Button>
          </div>
        </div>
        {asset
          ? <FileViewer blob={asset.blob} mimeType={asset.mimeType} fileName={asset.fileName} height="70vh" onDownload={() => onDownload(artifact)} />
          : <div className="gj-viewer gj-viewer--empty" style={{ height: "70vh" }}><span className="gj-viewer-loading">正在读取文件</span></div>}
      </div>
    </div>
  );
}
