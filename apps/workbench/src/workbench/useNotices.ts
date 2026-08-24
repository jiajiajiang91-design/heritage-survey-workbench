import { useState } from "react";

import type { FailureNotice } from "../failure-notice";

// 失败提示与状态通知。失败带原因与恢复操作（07 第 5.6 节），通知只是一句话。
export function useNotices() {
  const [error, setError] = useState<FailureNotice | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  return { error, notice, setError, setNotice };
}

export type Notices = ReturnType<typeof useNotices>;
