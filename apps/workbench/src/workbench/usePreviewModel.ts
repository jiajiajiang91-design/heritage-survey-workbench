import { useEffect, useState } from "react";
import type { ProjectHead } from "@gujian/application";
import type { AssetRecord } from "@gujian/domain";
import { buildPreviewReadModel } from "../preview-read-model";
import { projectRepository } from "../workbench";
export function usePreviewModel(head: ProjectHead) {
  const [metadata, setMetadata] = useState<{ projectId: string; assets: AssetRecord[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false; setMetadata(null); setError(null);
    void projectRepository.getProjectAssets(head.projectId).then((assets) => {
      if (!cancelled) setMetadata({ projectId: head.projectId, assets: assets.map((item) => item.record) });
    }).catch(() => { if (!cancelled) { setMetadata({ projectId: head.projectId, assets: [] }); setError("来源文件信息读取失败，请重新进入项目。"); } });
    return () => { cancelled = true; };
  }, [head.projectId, head.revisionId]);
  return { model: buildPreviewReadModel(head.snapshot, metadata?.projectId === head.projectId ? metadata.assets : []), loading: !metadata || metadata.projectId !== head.projectId, error };
}
