from pathlib import Path
from PIL import Image
import io,time,hashlib,json
Image.MAX_IMAGE_PIXELS=150_000_000
root=Path("文档/05_验证证据/03_公开实测样本/Dai_Loy_HABS")
rows=[]
for p in root.glob("highres_*.tif"):
    start=time.perf_counter()
    with Image.open(p) as image:
        image.load()
        before=hashlib.sha256(image.tobytes()).hexdigest()
        stream=io.BytesIO()
        image.save(stream,format="PNG")
        data=stream.getvalue()
        with Image.open(io.BytesIO(data)) as restored:
            restored.load()
            same=image.size==restored.size and image.mode==restored.mode and before==hashlib.sha256(restored.tobytes()).hexdigest()
        rows.append({"source":p.name,"mode":image.mode,"pixels":list(image.size),"pngBytes":len(data),"pixelsIdentical":same,"elapsedSeconds":round(time.perf_counter()-start,3)})
Path("文档/05_验证证据/23_T-DL-01资料预检/本机无损转换探查.json").write_text(json.dumps({"kind":"implementation-feasibility-only","runtime":"workers/cad/.venv Python with project Pillow","results":rows},ensure_ascii=False,indent=2),encoding="utf-8")
print(json.dumps(rows,ensure_ascii=False,indent=2))
