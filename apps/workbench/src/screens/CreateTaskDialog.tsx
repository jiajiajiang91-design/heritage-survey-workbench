import type { FormEvent } from "react";

import { Button, Field } from "../ui";
import type { CreateProjectValues } from "../workbench/useProjectSession";
import "./CreateTaskDialog.css";

// B01 新建任务（66:3851）：720 宽对话框，标题 18/26、说明 13/20、三步向导条、字段行 62 高、底部取消与主操作。
// 第一步建项目与对象；成果要求与确认在进入项目后的任务卡上完成（同一份表单，不在这里重复）。
export function CreateTaskDialog({ onSubmit, onClose }: { onSubmit: (values: CreateProjectValues) => Promise<boolean>; onClose: () => void }) {
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    await onSubmit({
      name: String(data.get("name") ?? "").trim(),
      buildingName: String(data.get("buildingName") ?? "").trim(),
      locationText: String(data.get("locationText") ?? "").trim(),
    });
  };
  return (
    <div className="gj-scrim" role="presentation" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <form className="sc-create" role="dialog" aria-modal="true" aria-labelledby="sc-create-title" onSubmit={(event) => void submit(event)}>
        <h2 className="sc-create-title" id="sc-create-title">建立单栋建筑任务</h2>
        <p className="sc-create-note">对象、范围和成果要求填完才能开始。缺一项，依赖它的成果就不生成。</p>
        <div className="sc-create-steps" aria-label="步骤">
          <span className="sc-create-step is-active">1 项目与对象</span>
          <span className="sc-create-step">2 成果要求</span>
          <span className="sc-create-step">3 确认</span>
        </div>
        <Field label="项目名称" required><input name="name" required maxLength={200} placeholder="例如：城隍庙山门保护记录" /></Field>
        <Field label="建筑名称" required><input name="buildingName" required maxLength={200} placeholder="例如：山门" /></Field>
        <Field label="地点"><input name="locationText" maxLength={500} placeholder="可暂时留空" /></Field>
        <p className="sc-create-note">第 2、3 步在进入项目后的任务卡上完成：成果目录、图幅与视图、适用规范和责任角色一次确认。</p>
        <span className="gj-spacer" />
        <div className="gj-dialog-actions">
          <Button onClick={onClose}>取消</Button>
          <Button variant="primary" type="submit">创建并进入项目</Button>
        </div>
      </form>
    </div>
  );
}
