import { useRef, useState } from "react";
import { Alert, Button } from "../ui";
import { productionErrors, type ProductionTaskValues } from "../production-task";
import { ProductionTaskFields } from "./ProductionTaskFields";
import "./CreateTaskDialog.css";
export function ProductionTaskForm({ initial, onSubmit, onCancel }: { initial: ProductionTaskValues; onSubmit: (value: ProductionTaskValues) => Promise<boolean>; onCancel: () => void }) {
  const [value, setValue] = useState(initial);
  const [errors, setErrors] = useState<Record<string,string>>({});
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState(false);
  const pending = useRef(false);
  return <form className="sc-production-form" noValidate onSubmit={async (e) => {
    e.preventDefault(); if (pending.current) return;
    const next = productionErrors(value); setErrors(next); if (Object.keys(next).length) return;
    pending.current = true; setSaving(true); setFailure(false);
    try { if (!await onSubmit(value)) setFailure(true); } catch { setFailure(true); }
    finally { setSaving(false); pending.current = false; }
  }}><fieldset disabled={saving} className="sc-production-fields"><ProductionTaskFields value={value} onChange={setValue} errors={errors} />
    <div className="gj-actions"><Button type="submit" variant="primary" busy={saving} disabled={saving}>保存基本设置</Button><Button onClick={onCancel}>继续使用原设置</Button></div>
  </fieldset>{failure && <Alert tone="danger" role="alert">保存未成功，填写内容已保留，请重试。</Alert>}</form>;
}
